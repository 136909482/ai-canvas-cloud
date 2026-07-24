import { createHash, randomUUID } from "node:crypto";
import {
  canonicalJsonStringify,
  createMigrationPackageContentDigestInput,
  validateCommitMigrationImportRequest,
  MigrationPackageValidationError,
  validatePrepareMigrationImportRequest,
  type MigrationAssetManifest,
  type MigrationImportCommitResponse,
  type MigrationImportCommitStrategy,
  type MigrationJsonObject,
  type MigrationPackageCheckpoint,
  type MigrationProjectGraph,
  type ProjectGraphOperation,
  type MigrationImportConflictType,
  type MigrationImportResponse,
  type MigrationImportStatus,
  type MigrationJsonValue,
  type MigrationPackageSourcePlatform,
  type PrepareMigrationImportRequest,
  type WorkspaceRole,
} from "@ai-canvas-cloud/contracts";
import type { DbClient, DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import {
  findReusableCompletedMigrationAsset,
  materializeMigrationAsset,
  type MaterializeMigrationAssetInput,
} from "../assets/service.js";
import { applyImportGraphTransaction } from "../project-graph/postgresProjectGraphService.js";
import { insertImportCheckpointTransaction } from "../project-snapshots/postgresProjectSnapshotService.js";
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from "../workspaces/authorization.js";
import {
  assertWorkspaceStorageCapacity,
  lockWorkspaceStorageQuota,
  readWorkspaceStorageUsage,
} from "../workspaces/usage.js";
import {
  MIGRATION_IMPORT_TTL_HOURS,
  MIGRATION_IMPORT_WRITE_ROLES,
  migrationImportNotFound,
  normalizeMigrationImportId,
  type MigrationImportService,
} from "./service.js";

const PROJECT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MigrationImportRow {
  id: string;
  package_id: string;
  source_platform: MigrationPackageSourcePlatform;
  source_project_id: string;
  source_project_version: string | number;
  source_project_sequence: string | number;
  project_name: string;
  request_fingerprint: string;
  status: MigrationImportStatus;
  conflict_type: MigrationImportConflictType;
  target_project_id: string | null;
  target_project_name: string | null;
  target_expected_version: string | number | null;
  target_expected_sequence: string | number | null;
  target_archived_at: Date | string | null;
  asset_count: number;
  total_file_count: number;
  completed_file_count: number;
  total_bytes: string | number;
  completed_bytes: string | number;
  estimated_storage_bytes: string | number;
  available_bytes_at_prepare: string | number;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  asset_manifest_json: MigrationAssetManifest;
  cancel_requested_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProjectConflictRow {
  id: string;
  workspace_id: string;
  name: string;
  version: string | number;
  last_sequence: string | number;
  archived_at: Date | string | null;
  deleted_at: Date | string | null;
}

interface PreparedConflict {
  type: MigrationImportConflictType;
  targetProjectId: string | null;
  targetProjectName: string | null;
  targetExpectedVersion: number | null;
  targetExpectedSequence: number | null;
  targetArchivedAt: string | null;
}

const IMPORT_COLUMNS = `
  id::text,
  package_id,
  source_platform,
  source_project_id,
  source_project_version,
  source_project_sequence,
  project_name,
  request_fingerprint,
  status,
  conflict_type,
  target_project_id::text,
  target_project_name,
  target_expected_version,
  target_expected_sequence,
  target_archived_at,
  asset_count,
  total_file_count,
  completed_file_count,
  total_bytes,
  completed_bytes,
  estimated_storage_bytes,
  available_bytes_at_prepare,
  retry_count,
  error_code,
  error_message,
  asset_manifest_json,
  cancel_requested_at,
  expires_at,
  created_at,
  updated_at
`;

function toIso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toSafeInteger(value: string | number, field: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return number;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function importInvalid(reason: string, field: string, message: string): never {
  throw new AuthServiceError({
    statusCode: 422,
    apiCode: "IMPORT_INVALID",
    message,
    details: { reason, field },
  });
}

function validateRequest(input: unknown): PrepareMigrationImportRequest {
  try {
    return validatePrepareMigrationImportRequest(input);
  } catch (error) {
    if (error instanceof MigrationPackageValidationError) {
      return importInvalid(
        error.code,
        error.field,
        "Migration package is invalid",
      );
    }
    throw error;
  }
}

function validateCommitRequest(input: unknown) {
  try {
    return validateCommitMigrationImportRequest(input);
  } catch (error) {
    if (error instanceof MigrationPackageValidationError) {
      return importInvalid(
        error.code,
        error.field,
        "Migration commit request is invalid",
      );
    }
    throw error;
  }
}

function canonicalPayload(value: unknown) {
  return canonicalJsonStringify(value as MigrationJsonValue);
}

function verifyPackageDigests(input: PrepareMigrationImportRequest) {
  const descriptors = new Map(
    input.manifest.files.map((file) => [file.path, file]),
  );
  const jsonFiles: Array<{ path: string; value: unknown }> = [
    { path: "project.json", value: input.projectRecord },
    { path: "graph.json", value: input.graph },
    { path: "assets.json", value: input.assetManifest },
    ...(input.checkpoint
      ? [{ path: "checkpoint.json", value: input.checkpoint }]
      : []),
  ];
  for (const file of jsonFiles) {
    const descriptor = descriptors.get(file.path);
    const canonical = canonicalPayload(file.value);
    if (
      !descriptor ||
      descriptor.byteSize !== Buffer.byteLength(canonical, "utf8") ||
      descriptor.sha256 !== sha256(canonical)
    ) {
      importInvalid(
        "FILE_DIGEST_MISMATCH",
        `manifest.files.${file.path}`,
        "Migration package JSON digest does not match manifest",
      );
    }
  }
  const entries = new Map(
    input.archiveEntries.map((entry) => [entry.path, entry]),
  );
  for (const descriptor of input.manifest.files) {
    if (entries.get(descriptor.path)?.sha256 !== descriptor.sha256) {
      importInvalid(
        "FILE_DIGEST_MISSING",
        `archiveEntries.${descriptor.path}`,
        "Migration package file digest is missing or invalid",
      );
    }
  }
  const expectedContentSha256 = sha256(
    createMigrationPackageContentDigestInput(input.manifest.files),
  );
  if (input.manifest.contentSha256 !== expectedContentSha256) {
    importInvalid(
      "CONTENT_DIGEST_MISMATCH",
      "manifest.contentSha256",
      "Migration package content digest does not match file descriptors",
    );
  }
}

function requestFingerprint(input: PrepareMigrationImportRequest) {
  return sha256(
    canonicalPayload({
      archiveEntries: input.archiveEntries,
      assetManifest: input.assetManifest,
      checkpoint: input.checkpoint,
      graph: input.graph,
      manifest: input.manifest,
      projectRecord: input.projectRecord,
    }),
  );
}

function allowedStrategies(
  conflictType: MigrationImportConflictType,
  role: WorkspaceRole,
  status: MigrationImportStatus,
) {
  if (
    conflictType === "none" ||
    role === "viewer" ||
    ["completed", "failed", "canceled", "expired"].includes(status)
  ) {
    return [];
  }
  if (conflictType !== "project_exists") {
    return ["copy"] as const;
  }
  return role === "owner" || role === "admin"
    ? (["copy", "replace"] as const)
    : (["copy"] as const);
}

function toResponse(
  row: MigrationImportRow,
  role: WorkspaceRole,
): MigrationImportResponse {
  const targetProject =
    row.conflict_type === "project_exists"
      ? {
          id: row.target_project_id!,
          name: row.target_project_name!,
          expectedVersion: toSafeInteger(
            row.target_expected_version!,
            "targetExpectedVersion",
          ),
          expectedSequence: toSafeInteger(
            row.target_expected_sequence!,
            "targetExpectedSequence",
          ),
          archivedAt: row.target_archived_at
            ? toIso(row.target_archived_at)
            : null,
        }
      : null;
  return {
    import: {
      id: row.id,
      status: row.status,
      packageId: row.package_id,
      sourcePlatform: row.source_platform,
      project: {
        sourceId: row.source_project_id,
        name: row.project_name,
        version: toSafeInteger(
          row.source_project_version,
          "sourceProjectVersion",
        ),
        sequence: toSafeInteger(
          row.source_project_sequence,
          "sourceProjectSequence",
        ),
      },
      conflict: {
        type: row.conflict_type,
        requiresResolution: row.conflict_type !== "none",
        targetProject,
      },
      allowedStrategies: [
        ...allowedStrategies(row.conflict_type, role, row.status),
      ],
      estimates: {
        assetCount: row.asset_count,
        fileCount: row.total_file_count,
        totalBytes: toSafeInteger(row.total_bytes, "totalBytes"),
        estimatedStorageBytes: toSafeInteger(
          row.estimated_storage_bytes,
          "estimatedStorageBytes",
        ),
        availableBytesAtPrepare: toSafeInteger(
          row.available_bytes_at_prepare,
          "availableBytesAtPrepare",
        ),
      },
      progress: {
        completedFileCount: row.completed_file_count,
        completedBytes: toSafeInteger(row.completed_bytes, "completedBytes"),
        retryCount: row.retry_count,
      },
      uploads: row.asset_manifest_json.assets.map((asset) => ({
        ...asset,
        required: true,
      })),
      error:
        row.error_code && row.error_message
          ? { code: row.error_code, message: row.error_message }
          : null,
      cancelRequestedAt: row.cancel_requested_at
        ? toIso(row.cancel_requested_at)
        : null,
      expiresAt: toIso(row.expires_at),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
  };
}

async function expireImport(
  client: DbClient,
  importId: string,
  workspaceId: string,
) {
  const result = await client.query(
    `
      UPDATE migration_imports
      SET status = 'expired', updated_at = now()
      WHERE id = $1
        AND workspace_id = $2
        AND expires_at <= now()
        AND status IN ('prepared', 'uploading', 'validating', 'ready')
      RETURNING id
    `,
    [importId, workspaceId],
  );
  if (result.rowCount) {
    await client.query(
      `UPDATE migration_import_asset_uploads
       SET status = 'expired', updated_at = now()
       WHERE import_id = $1 AND workspace_id = $2 AND status IN ('pending', 'uploading', 'validating')`,
      [importId, workspaceId],
    );
  }
}

async function findImport(
  client: Pick<DbClient, "query">,
  importId: string,
  workspaceId: string,
  forUpdate = false,
) {
  const result = await client.query<MigrationImportRow>(
    `
      SELECT ${IMPORT_COLUMNS}
      FROM migration_imports
      WHERE id = $1 AND workspace_id = $2
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [importId, workspaceId],
  );
  return result.rows[0] ?? migrationImportNotFound();
}

async function determineConflict(
  client: DbClient,
  sourceProjectId: string,
  workspaceId: string,
): Promise<PreparedConflict> {
  if (!PROJECT_UUID_PATTERN.test(sourceProjectId)) {
    return {
      type: "source_id_incompatible",
      targetProjectId: null,
      targetProjectName: null,
      targetExpectedVersion: null,
      targetExpectedSequence: null,
      targetArchivedAt: null,
    };
  }
  const result = await client.query<ProjectConflictRow>(
    `
      SELECT id::text, workspace_id::text, name, version, last_sequence, archived_at, deleted_at
      FROM projects
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [sourceProjectId],
  );
  const project = result.rows[0];
  if (!project) {
    return {
      type: "none",
      targetProjectId: null,
      targetProjectName: null,
      targetExpectedVersion: null,
      targetExpectedSequence: null,
      targetArchivedAt: null,
    };
  }
  if (project.workspace_id !== workspaceId || project.deleted_at) {
    return {
      type: "project_id_unavailable",
      targetProjectId: null,
      targetProjectName: null,
      targetExpectedVersion: null,
      targetExpectedSequence: null,
      targetArchivedAt: null,
    };
  }
  return {
    type: "project_exists",
    targetProjectId: project.id,
    targetProjectName: project.name,
    targetExpectedVersion: toSafeInteger(project.version, "targetVersion"),
    targetExpectedSequence: toSafeInteger(
      project.last_sequence,
      "targetSequence",
    ),
    targetArchivedAt: project.archived_at ? toIso(project.archived_at) : null,
  };
}

interface CommitImportRow extends MigrationImportRow {
  conflict_type: MigrationImportConflictType;
  target_project_id: string | null;
  target_expected_version: string | number | null;
  target_expected_sequence: string | number | null;
  manifest_json: MigrationJsonValue;
  project_record_json: MigrationJsonValue & { id: string; name: string };
  graph_json: MigrationProjectGraph;
  checkpoint_json: MigrationJsonValue | null;
  commit_idempotency_key: string | null;
  commit_request_fingerprint: string | null;
  commit_strategy: MigrationImportCommitStrategy | null;
  committed_project_id: string | null;
  committed_at: Date | string | null;
}

interface CommitUploadRow {
  logical_asset_id: string;
  object_key: string;
  status: MigrationImportStatus;
  committed_asset_id: string | null;
  expected_file_path: string;
  expected_original_file_name: string | null;
  expected_mime_type: string;
  expected_byte_size: string | number;
  expected_sha256: string;
  expected_width: number | null;
  expected_height: number | null;
  expected_asset_kind: MigrationAssetManifest["assets"][number]["assetKind"];
}

function rewriteMigrationValue(
  value: unknown,
  key: string | null,
  assetIds: Map<string, string>,
  assetPaths: Map<string, string>,
): unknown {
  if (typeof value === "string") {
    if (key === "assetId" && assetIds.has(value)) {
      return assetIds.get(value);
    }
    if (
      (key === "relativePath" ||
        key === "thumbnailRelativePath" ||
        key === "previewRelativePath") &&
      assetPaths.has(value)
    ) {
      return `cloud-assets/${assetPaths.get(value)}`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteMigrationValue(entry, null, assetIds, assetPaths),
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      rewriteMigrationValue(entryValue, entryKey, assetIds, assetPaths),
    ]),
  );
}

interface MigrationGraphIdentityMaps {
  nodeIds: Map<string, string>;
  edgeIds: Map<string, string>;
}

function mappedEntityId(ids: Map<string, string>, sourceId: string) {
  const existing = ids.get(sourceId);
  if (existing) {
    return existing;
  }
  const mapped = randomUUID();
  ids.set(sourceId, mapped);
  return mapped;
}

function rewriteMigrationGraph(
  graph: MigrationProjectGraph,
  assetIds: Map<string, string>,
  assetPaths: Map<string, string>,
  identityMaps?: MigrationGraphIdentityMaps,
) {
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      id: identityMaps
        ? mappedEntityId(identityMaps.nodeIds, node.id)
        : node.id,
      ...(node.parentNodeId
        ? {
            parentNodeId: identityMaps
              ? mappedEntityId(identityMaps.nodeIds, node.parentNodeId)
              : node.parentNodeId,
          }
        : {}),
      data: rewriteMigrationValue(
        node.data,
        null,
        assetIds,
        assetPaths,
      ) as MigrationJsonObject,
      presentation: node.presentation
        ? (rewriteMigrationValue(
            node.presentation,
            null,
            assetIds,
            assetPaths,
          ) as MigrationJsonObject)
        : undefined,
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      id: identityMaps
        ? mappedEntityId(identityMaps.edgeIds, edge.id)
        : edge.id,
      source: identityMaps
        ? mappedEntityId(identityMaps.nodeIds, edge.source)
        : edge.source,
      target: identityMaps
        ? mappedEntityId(identityMaps.nodeIds, edge.target)
        : edge.target,
      data: edge.data
        ? (rewriteMigrationValue(
            edge.data,
            null,
            assetIds,
            assetPaths,
          ) as MigrationJsonObject)
        : undefined,
    })),
  } satisfies Pick<MigrationProjectGraph, "nodes" | "edges">;
}

function commitResponse(
  row: CommitImportRow,
  project: { id: string; name: string; version: number; sequence: number },
  assetCount: number,
  checkpoint: MigrationImportCommitResponse["checkpoint"] = null,
): MigrationImportCommitResponse {
  return {
    importId: row.id,
    status: "completed",
    strategy: row.commit_strategy!,
    project,
    assetCount,
    checkpoint,
  };
}

export function createPostgresMigrationImportService(
  pool: DbPool,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): MigrationImportService {
  const authorizationService =
    options.authorizationService ?? createWorkspaceAuthorizationService(pool);

  return {
    async prepareImport(rawInput, actor) {
      const access = await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: MIGRATION_IMPORT_WRITE_ROLES,
      });
      const input = validateRequest(rawInput);
      verifyPackageDigests(input);
      const fingerprint = requestFingerprint(input);
      return withTransaction(pool, async (client) => {
        await lockWorkspaceStorageQuota(client, actor.workspaceId);
        const existingResult = await client.query<MigrationImportRow>(
          `SELECT ${IMPORT_COLUMNS} FROM migration_imports
           WHERE workspace_id = $1 AND idempotency_key = $2
           LIMIT 1 FOR UPDATE`,
          [actor.workspaceId, input.idempotencyKey],
        );
        const existing = existingResult.rows[0];
        if (existing) {
          if (existing.request_fingerprint !== fingerprint) {
            throw new AuthServiceError({
              statusCode: 409,
              apiCode: "IMPORT_CONFLICT",
              message:
                "Migration import idempotency key was reused with different content",
            });
          }
          await expireImport(client, existing.id, actor.workspaceId);
          return toResponse(
            await findImport(client, existing.id, actor.workspaceId),
            access.member.role,
          );
        }

        const estimatedStorageBytes = input.assetManifest.assets.reduce(
          (total, asset) => total + asset.byteSize,
          0,
        );
        if (!Number.isSafeInteger(estimatedStorageBytes)) {
          importInvalid(
            "PACKAGE_LIMIT_EXCEEDED",
            "assetManifest.assets",
            "Migration asset bytes exceed safe limits",
          );
        }
        const usage = await readWorkspaceStorageUsage(
          client,
          actor.workspaceId,
        );
        assertWorkspaceStorageCapacity(usage, estimatedStorageBytes);
        const conflict = await determineConflict(
          client,
          input.manifest.project.id,
          actor.workspaceId,
        );
        const result = await client.query<MigrationImportRow>(
          `
            INSERT INTO migration_imports (
              workspace_id, created_by_user_id, package_schema_version, package_id,
              source_platform, source_project_id, source_project_version, source_project_sequence,
              project_name, request_fingerprint, content_sha256, idempotency_key,
              conflict_type, target_project_id, target_project_name,
              target_expected_version, target_expected_sequence, target_archived_at,
              asset_count, total_file_count, total_bytes, estimated_storage_bytes,
              available_bytes_at_prepare, manifest_json, project_record_json, graph_json,
              asset_manifest_json, checkpoint_json, expires_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
              $24::jsonb, $25::jsonb, $26::jsonb, $27::jsonb, $28::jsonb,
              now() + ($29 * interval '1 hour')
            )
            RETURNING ${IMPORT_COLUMNS}
          `,
          [
            actor.workspaceId,
            actor.userId,
            input.manifest.packageSchemaVersion,
            input.manifest.packageId,
            input.manifest.sourcePlatform,
            input.manifest.project.id,
            input.manifest.project.version,
            input.manifest.project.sequence,
            input.projectRecord.name,
            fingerprint,
            input.manifest.contentSha256,
            input.idempotencyKey,
            conflict.type,
            conflict.targetProjectId,
            conflict.targetProjectName,
            conflict.targetExpectedVersion,
            conflict.targetExpectedSequence,
            conflict.targetArchivedAt,
            input.assetManifest.assets.length,
            input.manifest.fileCount,
            input.manifest.totalByteSize,
            estimatedStorageBytes,
            usage.storage.availableBytes,
            JSON.stringify(input.manifest),
            JSON.stringify(input.projectRecord),
            JSON.stringify(input.graph),
            JSON.stringify(input.assetManifest),
            input.checkpoint ? JSON.stringify(input.checkpoint) : null,
            MIGRATION_IMPORT_TTL_HOURS,
          ],
        );
        return toResponse(result.rows[0]!, access.member.role);
      });
    },

    async getImport(rawImportId, actor) {
      const access = await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      });
      const importId = normalizeMigrationImportId(rawImportId);
      return withTransaction(pool, async (client) => {
        await expireImport(client, importId, actor.workspaceId);
        return toResponse(
          await findImport(client, importId, actor.workspaceId),
          access.member.role,
        );
      });
    },

    async cancelImport(rawImportId, actor) {
      const access = await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: MIGRATION_IMPORT_WRITE_ROLES,
      });
      const importId = normalizeMigrationImportId(rawImportId);
      return withTransaction(pool, async (client) => {
        await expireImport(client, importId, actor.workspaceId);
        const current = await findImport(
          client,
          importId,
          actor.workspaceId,
          true,
        );
        if (current.status === "completed") {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "IMPORT_CONFLICT",
            message: "Completed migration import cannot be canceled",
          });
        }
        if (
          current.status === "canceled" ||
          current.status === "expired" ||
          current.status === "failed"
        ) {
          return toResponse(current, access.member.role);
        }
        const result = await client.query<MigrationImportRow>(
          current.status === "committing"
            ? `UPDATE migration_imports
               SET cancel_requested_at = COALESCE(cancel_requested_at, now()), updated_at = now()
               WHERE id = $1 AND workspace_id = $2
               RETURNING ${IMPORT_COLUMNS}`
            : `UPDATE migration_imports
               SET status = 'canceled', cancel_requested_at = COALESCE(cancel_requested_at, now()),
                   canceled_at = COALESCE(canceled_at, now()), updated_at = now()
               WHERE id = $1 AND workspace_id = $2
               RETURNING ${IMPORT_COLUMNS}`,
          [importId, actor.workspaceId],
        );
        if (current.status !== "committing") {
          await client.query(
            `UPDATE migration_import_asset_uploads
             SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()), updated_at = now()
             WHERE import_id = $1 AND workspace_id = $2 AND status IN ('pending', 'uploading', 'validating')`,
            [importId, actor.workspaceId],
          );
        }
        return toResponse(result.rows[0]!, access.member.role);
      });
    },

    async commitImport(rawImportId, rawInput, actor) {
      const access = await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: MIGRATION_IMPORT_WRITE_ROLES,
      });
      const importId = normalizeMigrationImportId(rawImportId);
      const input = validateCommitRequest(rawInput);
      const fingerprint = sha256(canonicalPayload(input));
      return withTransaction(pool, async (client) => {
        await lockWorkspaceStorageQuota(client, actor.workspaceId);
        const importResult = await client.query<CommitImportRow>(
          `
            SELECT ${IMPORT_COLUMNS},
              manifest_json, project_record_json, graph_json, checkpoint_json,
              commit_idempotency_key, commit_request_fingerprint, commit_strategy,
              committed_project_id, committed_at
            FROM migration_imports
            WHERE id = $1 AND workspace_id = $2
            FOR UPDATE
          `,
          [importId, actor.workspaceId],
        );
        const current = importResult.rows[0] ?? migrationImportNotFound();
        if (current.status === "completed") {
          if (
            current.commit_idempotency_key !== input.idempotencyKey ||
            current.commit_request_fingerprint !== fingerprint
          ) {
            throw new AuthServiceError({
              statusCode: 409,
              apiCode: "IMPORT_CONFLICT",
              message:
                "Migration import has already been committed with different request content",
            });
          }
          const project = (
            await client.query<{
              id: string;
              name: string;
              version: string | number;
              last_sequence: string | number;
            }>(
              `SELECT id::text, name, version, last_sequence FROM projects WHERE id = $1 AND workspace_id = $2`,
              [current.committed_project_id, actor.workspaceId],
            )
          ).rows[0];
          if (!project) {
            throw new Error("Committed migration project is missing");
          }
          const count =
            (
              await client.query<{ count: string | number }>(
                `SELECT count(*) AS count FROM migration_import_asset_uploads WHERE import_id = $1 AND workspace_id = $2 AND committed_asset_id IS NOT NULL`,
                [importId, actor.workspaceId],
              )
            ).rows[0]?.count ?? 0;
          const checkpointRow = (
            await client.query<{
              id: string;
              project_version: string | number;
              last_sequence: string | number;
            }>(
              `
              SELECT id::text, project_version, last_sequence
              FROM project_snapshots
              WHERE project_id = $1 AND project_version = $2 AND last_sequence = $3
                AND snapshot_type = 'import' AND is_valid
              ORDER BY created_at DESC, id DESC
              LIMIT 1
            `,
              [project.id, project.version, project.last_sequence],
            )
          ).rows[0];
          return commitResponse(
            current,
            {
              id: project.id,
              name: project.name,
              version: Number(project.version),
              sequence: Number(project.last_sequence),
            },
            Number(count),
            checkpointRow
              ? {
                  id: checkpointRow.id,
                  projectVersion: Number(checkpointRow.project_version),
                  sequence: Number(checkpointRow.last_sequence),
                }
              : null,
          );
        }
        if (current.status !== "ready") {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "IMPORT_CONFLICT",
            message: "Migration import is not ready to commit",
          });
        }

        const uploadResult = await client.query<CommitUploadRow>(
          `
            SELECT logical_asset_id, object_key, status, committed_asset_id,
              expected_file_path, expected_original_file_name, expected_mime_type,
              expected_byte_size, expected_sha256, expected_width, expected_height, expected_asset_kind
            FROM migration_import_asset_uploads
            WHERE import_id = $1 AND workspace_id = $2
            ORDER BY logical_asset_id
            FOR UPDATE
          `,
          [importId, actor.workspaceId],
        );
        if (
          uploadResult.rows.length !== Number(current.asset_count) ||
          uploadResult.rows.some(
            (upload) =>
              upload.status !== "completed" || upload.committed_asset_id,
          )
        ) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "IMPORT_CONFLICT",
            message: "All migration assets must be completed before commit",
          });
        }
        const strategy = input.strategy as MigrationImportCommitStrategy;
        if (strategy === "replace") {
          if (
            access.member.role !== "owner" &&
            access.member.role !== "admin"
          ) {
            throw new AuthServiceError({
              statusCode: 403,
              apiCode: "ACCESS_DENIED",
              message:
                "Only workspace owner or admin can replace a project during import",
            });
          }
          if (
            current.conflict_type !== "project_exists" ||
            !current.target_project_id ||
            input.confirmReplace !== true ||
            input.expectedVersion === undefined ||
            input.expectedSequence === undefined ||
            input.expectedVersion !== Number(current.target_expected_version) ||
            input.expectedSequence !== Number(current.target_expected_sequence)
          ) {
            throw new AuthServiceError({
              statusCode: 409,
              apiCode: "PROJECT_VERSION_CONFLICT",
              message:
                "Replace requires explicit confirmation and the prepare version snapshot",
              details: {
                expectedVersion: Number(current.target_expected_version),
                expectedSequence: Number(current.target_expected_sequence),
              },
            });
          }
        }

        const usage = await readWorkspaceStorageUsage(
          client,
          actor.workspaceId,
        );
        assertWorkspaceStorageCapacity(usage, 0);
        const targetProjectId =
          strategy === "replace" ? current.target_project_id! : randomUUID();
        const projectName = current.project_record_json.name;
        if (strategy === "copy") {
          try {
            await client.query(
              `INSERT INTO projects (id, workspace_id, name) VALUES ($1, $2, $3)`,
              [targetProjectId, actor.workspaceId, projectName],
            );
          } catch (error) {
            if ((error as { code?: string }).code === "23505") {
              throw new AuthServiceError({
                statusCode: 409,
                apiCode: "IMPORT_CONFLICT",
                message:
                  "Target project ID became unavailable during import commit",
              });
            }
            throw error;
          }
        }

        const assetIds = new Map<string, string>();
        const assetPaths = new Map<string, string>();
        for (const upload of uploadResult.rows) {
          const asset = current.asset_manifest_json.assets.find(
            (candidate) => candidate.logicalAssetId === upload.logical_asset_id,
          );
          if (
            !asset ||
            asset.filePath !== upload.expected_file_path ||
            asset.sha256 !== upload.expected_sha256
          ) {
            throw new AuthServiceError({
              statusCode: 422,
              apiCode: "ASSET_VALIDATION_FAILED",
              message:
                "Migration asset upload metadata no longer matches the import manifest",
            });
          }
          const reusableAssetId = await findReusableCompletedMigrationAsset(
            client,
            {
              workspaceId: actor.workspaceId,
              sha256: asset.sha256,
              byteSize: asset.byteSize,
              mimeType: asset.mimeType,
            },
          );
          const materialized =
            reusableAssetId ??
            (await materializeMigrationAsset(client, {
              workspaceId: actor.workspaceId,
              projectId: targetProjectId,
              createdByUserId: actor.userId,
              objectKey: upload.object_key,
              asset,
            } satisfies MaterializeMigrationAssetInput));
          assetIds.set(asset.logicalAssetId, materialized);
          assetPaths.set(asset.filePath, materialized);
          await client.query(
            `UPDATE migration_import_asset_uploads SET committed_asset_id = $1 WHERE import_id = $2 AND workspace_id = $3 AND logical_asset_id = $4`,
            [
              materialized,
              importId,
              actor.workspaceId,
              upload.logical_asset_id,
            ],
          );
        }

        const identityMaps =
          strategy === "copy"
            ? {
                nodeIds: new Map<string, string>(),
                edgeIds: new Map<string, string>(),
              }
            : undefined;
        const rewritten = rewriteMigrationGraph(
          current.graph_json,
          assetIds,
          assetPaths,
          identityMaps,
        );
        const operations: ProjectGraphOperation[] = [
          ...rewritten.nodes.map(
            (node) => ({ type: "upsertNode", node }) as ProjectGraphOperation,
          ),
          ...rewritten.edges.map(
            (edge) => ({ type: "upsertEdge", edge }) as ProjectGraphOperation,
          ),
        ];
        const graphResult = await applyImportGraphTransaction(client, {
          projectId: targetProjectId,
          workspaceId: actor.workspaceId,
          actorUserId: actor.userId,
          expectedVersion: strategy === "replace" ? input.expectedVersion! : 0,
          expectedSequence:
            strategy === "replace" ? input.expectedSequence! : 0,
          operations,
          replaceExisting: strategy === "replace",
          idempotencyKey: `migration:${importId}`,
        });

        let checkpoint: MigrationImportCommitResponse["checkpoint"] = null;
        if (current.checkpoint_json) {
          const packageCheckpoint =
            current.checkpoint_json as unknown as MigrationPackageCheckpoint;
          const checkpointGraph = rewriteMigrationGraph(
            {
              schemaVersion: 1,
              projectId: targetProjectId,
              version: graphResult.version,
              sequence: graphResult.sequence,
              nodes: packageCheckpoint.record.canvas.nodes,
              edges: packageCheckpoint.record.canvas.edges,
            },
            assetIds,
            assetPaths,
            identityMaps,
          );
          const checkpointAssetManifest = packageCheckpoint.assetIds
            .map((assetId) => assetIds.get(assetId))
            .filter((assetId): assetId is string => Boolean(assetId))
            .sort();
          checkpoint = await insertImportCheckpointTransaction(client, {
            projectId: targetProjectId,
            projectName,
            projectVersion: graphResult.version,
            sequence: graphResult.sequence,
            nodes: checkpointGraph.nodes.map((node) => node as never),
            edges: checkpointGraph.edges.map((edge) => edge as never),
            taskQueue: {
              tasks: packageCheckpoint.record.taskQueue.tasks as Record<
                string,
                unknown
              >[],
            },
            assetManifest: checkpointAssetManifest,
          });
        }

        await client.query(
          `
            UPDATE migration_imports
            SET status = 'completed', completed_at = now(), commit_idempotency_key = $3,
                commit_request_fingerprint = $4, commit_strategy = $5,
                committed_project_id = $6, committed_at = now(), updated_at = now()
            WHERE id = $1 AND workspace_id = $2
          `,
          [
            importId,
            actor.workspaceId,
            input.idempotencyKey,
            fingerprint,
            strategy,
            targetProjectId,
          ],
        );
        return commitResponse(
          { ...current, commit_strategy: strategy },
          {
            id: targetProjectId,
            name: projectName,
            version: graphResult.version,
            sequence: graphResult.sequence,
          },
          assetIds.size,
          checkpoint,
        );
      });
    },
  };
}
