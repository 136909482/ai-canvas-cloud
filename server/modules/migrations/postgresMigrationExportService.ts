import { createHash, randomUUID } from "node:crypto";
import type {
  MigrationExportResponse,
  MigrationPackageAsset,
  MigrationPackageArchiveEntry,
  MigrationPackageCheckpoint,
  MigrationPackageFileDescriptor,
  MigrationPackageManifest,
  MigrationJsonObject,
  MigrationProjectGraph,
  MigrationProjectRecord,
  MigrationProjectSnapshot,
  ProjectGraphEdge,
  ProjectGraphNode,
  PrepareMigrationExportRequest,
} from "@ai-canvas-cloud/contracts";
import {
  canonicalJsonStringify,
  createMigrationPackageContentDigestInput,
  validateMigrationPackageContract,
} from "@ai-canvas-cloud/contracts";
import type { DbClient, DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import type { ProjectActor } from "../projects/service.js";
import {
  collectAssetIdsFromNodeReferenceChanges,
  collectNodeAssetReferenceChangesForNodes,
} from "../project-graph/assetReferences.js";
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from "../workspaces/authorization.js";
import {
  buildZip,
  MIGRATION_EXPORT_DOWNLOAD_TTL_SECONDS,
  MIGRATION_EXPORT_GC_GRACE_HOURS,
  MIGRATION_EXPORT_MAX_RETRIES,
  MIGRATION_EXPORT_TTL_HOURS,
  MIGRATION_EXPORT_WRITE_ROLES,
  type ExportAssetFile,
  type MigrationExportObjectStorage,
  type MigrationExportService,
} from "./exportService.js";

interface ExportProjectGraphRow {
  nodes_json: ProjectGraphNode[];
  edges_json: ProjectGraphEdge[];
}

interface ExportRow {
  id: string;
  workspace_id: string;
  project_id: string;
  project_name: string;
  status: MigrationExportResponse["export"]["status"];
  request_fingerprint: string;
  retry_count: number;
  project_version: string | number;
  project_sequence: string | number;
  file_count: number;
  completed_file_count: number;
  total_bytes: string | number;
  completed_bytes: string | number;
  manifest_json: MigrationPackageManifest;
  project_record_json: MigrationProjectRecord;
  graph_json: MigrationProjectGraph;
  asset_manifest_json: { schemaVersion: 1; assets: MigrationPackageAsset[] };
  checkpoint_json: MigrationPackageCheckpoint | null;
  export_assets_json: ExportAssetFile[];
  archive_object_key: string | null;
  archive_byte_size: string | number | null;
  archive_sha256: string | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LockedProjectRow {
  id: string;
  name: string;
  version: string | number;
  last_sequence: string | number;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
  saved_snapshot_id: string | null;
}

interface SavedSnapshotRow {
  id: string;
  snapshot_type: "manual" | "periodic" | "import" | "pre_restore";
  project_version: string | number;
  last_sequence: string | number;
  created_at: Date | string;
  record_json: {
    project: {
      id: string;
      name: string;
      version: number;
      lastSequence: number;
    };
    canvas: { nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] };
  };
}

interface AssetRow {
  id: string;
  object_key: string;
  original_file_name: string | null;
  mime_type: string;
  byte_size: string | number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  asset_kind: MigrationPackageAsset["assetKind"];
}

const EXPORT_COLUMNS = `
  id::text,
  workspace_id::text,
  project_id::text,
  project_name,
  status,
  request_fingerprint,
  COALESCE((to_jsonb(migration_exports)->>'retry_count')::integer, 0) AS retry_count,
  project_version,
  project_sequence,
  file_count,
  completed_file_count,
  total_bytes,
  completed_bytes,
  manifest_json,
  project_record_json,
  graph_json,
  asset_manifest_json,
  checkpoint_json,
  export_assets_json,
  archive_object_key,
  archive_byte_size,
  archive_sha256,
  error_code,
  error_message,
  cancel_requested_at,
  expires_at,
  created_at,
  updated_at
`;

const retryColumnSupport = new WeakMap<object, Promise<boolean>>();

function supportsRetryColumn(pool: DbPool) {
  const existing = retryColumnSupport.get(pool);
  if (existing) return existing;
  const pending = pool
    .query<{ supported: boolean }>(
      `
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'migration_exports' AND column_name = 'retry_count'
    ) AS supported
  `,
    )
    .then((result) => result.rows[0]?.supported === true);
  retryColumnSupport.set(pool, pending);
  return pending;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_EXPORT_OBJECT_BYTES = 2 * 1024 * 1024 * 1024;

function assertProjectId(projectId: string) {
  if (!UUID_PATTERN.test(projectId)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid project id",
    });
  }
}

function normalizeExportId(exportId: unknown) {
  if (typeof exportId !== "string" || !UUID_PATTERN.test(exportId)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid migration export id",
    });
  }
  return exportId.toLowerCase();
}

function exportNotFound(): never {
  throw new AuthServiceError({
    statusCode: 404,
    apiCode: "RESOURCE_NOT_FOUND",
    message: "Migration export not found",
  });
}

function toIso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toResponse(row: ExportRow): MigrationExportResponse {
  return {
    export: {
      id: row.id,
      status: row.status,
      project: {
        id: row.project_id,
        name: row.project_name,
        version: Number(row.project_version),
        sequence: Number(row.project_sequence),
      },
      progress: {
        fileCount: row.file_count,
        completedFileCount: row.completed_file_count,
        totalBytes: Number(row.total_bytes),
        completedBytes: Number(row.completed_bytes),
        retryCount: row.retry_count,
      },
      archive:
        row.archive_byte_size !== null && row.archive_sha256
          ? {
              byteSize: Number(row.archive_byte_size),
              sha256: row.archive_sha256,
            }
          : null,
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

function requestFingerprint(input: PrepareMigrationExportRequest) {
  return createHash("sha256").update(canonicalPayload(input)).digest("hex");
}

function canonicalPayload(input: PrepareMigrationExportRequest) {
  return canonicalJsonStringify({
    idempotencyKey: input.idempotencyKey,
    expectedVersion: input.expectedVersion ?? null,
    expectedSequence: input.expectedSequence ?? null,
  } as never);
}

function normalizeRequest(input: unknown): PrepareMigrationExportRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Migration export request must be an object",
    });
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    "idempotencyKey",
    "expectedVersion",
    "expectedSequence",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Migration export request contains unsupported fields",
    });
  }
  if (
    typeof value.idempotencyKey !== "string" ||
    value.idempotencyKey.trim().length < 1 ||
    value.idempotencyKey.length > 200
  ) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "idempotencyKey must be between 1 and 200 characters",
    });
  }
  for (const field of ["expectedVersion", "expectedSequence"] as const) {
    if (
      value[field] !== undefined &&
      (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0)
    ) {
      throw new AuthServiceError({
        statusCode: 400,
        apiCode: "VALIDATION_FAILED",
        message: `${field} must be a non-negative safe integer`,
      });
    }
  }
  return {
    idempotencyKey: value.idempotencyKey.trim(),
    ...(value.expectedVersion === undefined
      ? {}
      : { expectedVersion: Number(value.expectedVersion) }),
    ...(value.expectedSequence === undefined
      ? {}
      : { expectedSequence: Number(value.expectedSequence) }),
  };
}

function canonicalJson(value: unknown) {
  return Buffer.from(canonicalJsonStringify(value as never), "utf8");
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    default:
      return "mp4";
  }
}

function createPortableAssetFiles(rows: AssetRow[]) {
  return rows.map((row, index) => {
    const logicalAssetId = `asset-${index + 1}`;
    return {
      logicalAssetId,
      filePath: `assets/${logicalAssetId}.${extensionForMimeType(row.mime_type)}`,
      objectKey: row.object_key,
      byteSize: Number(row.byte_size),
      sha256: row.sha256!,
    } satisfies ExportAssetFile;
  });
}

function rewriteValue(
  value: unknown,
  key: string | null,
  byId: ReadonlyMap<string, ExportAssetFile>,
  byPath: ReadonlyMap<string, ExportAssetFile>,
): unknown {
  if (typeof value === "string") {
    if (key === "assetId") {
      return byId.get(value.toLowerCase())?.logicalAssetId ?? value;
    }
    if (
      key === "relativePath" ||
      key === "thumbnailRelativePath" ||
      key === "previewRelativePath"
    ) {
      return (
        byPath.get(value)?.filePath ??
        byPath.get(value.toLowerCase())?.filePath ??
        value
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteValue(entry, null, byId, byPath));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      rewriteValue(entryValue, entryKey, byId, byPath),
    ]),
  );
}

function rewriteNodes(
  nodes: ProjectGraphNode[],
  byId: ReadonlyMap<string, ExportAssetFile>,
  byPath: ReadonlyMap<string, ExportAssetFile>,
) {
  return nodes.map((node) => ({
    ...node,
    data: rewriteValue(node.data, null, byId, byPath),
    ...(node.presentation
      ? { presentation: rewriteValue(node.presentation, null, byId, byPath) }
      : {}),
  }));
}

function rewriteEdges(
  edges: ProjectGraphEdge[],
  byId: ReadonlyMap<string, ExportAssetFile>,
  byPath: ReadonlyMap<string, ExportAssetFile>,
) {
  return edges.map((edge) => ({
    ...edge,
    ...(edge.data ? { data: rewriteValue(edge.data, null, byId, byPath) } : {}),
  }));
}

function toMigrationSnapshot(
  nodes: ProjectGraphNode[],
  edges: ProjectGraphEdge[],
  byId: ReadonlyMap<string, ExportAssetFile>,
  byPath: ReadonlyMap<string, ExportAssetFile>,
): MigrationProjectSnapshot {
  return {
    schemaVersion: 1,
    canvas: {
      nodes: rewriteNodes(
        nodes,
        byId,
        byPath,
      ) as unknown as MigrationJsonObject[],
      edges: rewriteEdges(
        edges,
        byId,
        byPath,
      ) as unknown as MigrationJsonObject[],
    },
    taskQueue: { tasks: [] },
  };
}

function assetIdsFromNodes(nodes: ProjectGraphNode[]) {
  return collectAssetIdsFromNodeReferenceChanges(
    collectNodeAssetReferenceChangesForNodes(nodes),
  );
}

function buildExportPackage(input: {
  manifest: MigrationPackageManifest;
  projectRecord: MigrationProjectRecord;
  graph: MigrationProjectGraph;
  assetManifest: { schemaVersion: 1; assets: MigrationPackageAsset[] };
  checkpoint: MigrationPackageCheckpoint | null;
  jsonFiles: Map<string, Uint8Array>;
  assetBodies: Map<string, Uint8Array>;
}) {
  const descriptorFiles: MigrationPackageFileDescriptor[] = [];
  for (const [path, body] of input.jsonFiles) {
    if (path === "manifest.json") continue;
    descriptorFiles.push({
      path,
      byteSize: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
  for (const asset of input.assetManifest.assets) {
    const body = input.assetBodies.get(asset.logicalAssetId);
    if (!body)
      throw new Error(`Export asset body missing: ${asset.logicalAssetId}`);
    descriptorFiles.push({
      path: asset.filePath,
      byteSize: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
  descriptorFiles.sort((left, right) => left.path.localeCompare(right.path));
  const manifest: MigrationPackageManifest = {
    ...input.manifest,
    fileCount: descriptorFiles.length,
    totalByteSize: descriptorFiles.reduce(
      (total, file) => total + file.byteSize,
      0,
    ),
    files: descriptorFiles,
    contentSha256: createHash("sha256")
      .update(
        createMigrationPackageContentDigestInput(descriptorFiles) as string,
      )
      .digest("hex"),
  };
  const manifestBody = canonicalJson(manifest);
  const files: ZipFile[] = [{ path: "manifest.json", body: manifestBody }];
  for (const descriptor of descriptorFiles) {
    const body =
      input.jsonFiles.get(descriptor.path) ??
      input.assetBodies.get(
        input.assetManifest.assets.find(
          (asset) => asset.filePath === descriptor.path,
        )?.logicalAssetId ?? "",
      );
    if (!body)
      throw new Error(`Export descriptor body missing: ${descriptor.path}`);
    files.push({ path: descriptor.path, body });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const archiveEntries: MigrationPackageArchiveEntry[] = files.map((file) => ({
    path: file.path,
    kind: "file",
    uncompressedSize: file.body.byteLength,
    compressedSize: file.body.byteLength,
    sha256: createHash("sha256").update(file.body).digest("hex"),
  }));
  validateMigrationPackageContract({
    manifest,
    projectRecord: input.projectRecord,
    graph: input.graph,
    assetManifest: input.assetManifest,
    checkpoint: input.checkpoint,
    archiveEntries,
  });
  return { body: buildZip(files), manifest };
}

type ZipFile = { path: string; body: Uint8Array };

export function createPostgresMigrationExportService(
  pool: DbPool,
  objectStorage: MigrationExportObjectStorage,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): MigrationExportService {
  const authorizationService =
    options.authorizationService ?? createWorkspaceAuthorizationService(pool);

  async function authorize(actor: ProjectActor, write = false) {
    await authorizationService.requireWorkspaceAccess({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      ...(write ? { allowedRoles: MIGRATION_EXPORT_WRITE_ROLES } : {}),
    });
  }

  async function findExport(
    client: Pick<DbClient, "query">,
    projectId: string,
    exportId: string,
    workspaceId: string,
    lock = false,
  ) {
    const result = await client.query<ExportRow>(
      `SELECT ${EXPORT_COLUMNS} FROM migration_exports WHERE id = $1 AND workspace_id = $2 AND project_id = $3 ${lock ? "FOR UPDATE" : ""}`,
      [exportId, workspaceId, projectId],
    );
    return result.rows[0] ?? exportNotFound();
  }

  async function expireExport(client: Pick<DbClient, "query">, row: ExportRow) {
    if (
      new Date(row.expires_at).getTime() <= Date.now() &&
      !["completed", "canceled", "expired"].includes(row.status)
    ) {
      const result = await client.query<ExportRow>(
        `UPDATE migration_exports SET status = 'expired', updated_at = now() WHERE id = $1 RETURNING ${EXPORT_COLUMNS}`,
        [row.id],
      );
      return result.rows[0] ?? row;
    }
    return row;
  }

  return {
    async prepareExport(projectId, rawInput, actor) {
      await authorize(actor);
      const input = normalizeRequest(rawInput);
      const fingerprint = requestFingerprint(input);
      assertProjectId(projectId);

      const prepared = await withTransaction(pool, async (client) => {
        const existingResult = await client.query<ExportRow>(
          `SELECT ${EXPORT_COLUMNS} FROM migration_exports WHERE workspace_id = $1 AND idempotency_key = $2 FOR UPDATE`,
          [actor.workspaceId, input.idempotencyKey],
        );
        const existing = existingResult.rows[0];
        if (existing) {
          if (existing.request_fingerprint !== fingerprint) {
            throw new AuthServiceError({
              statusCode: 409,
              apiCode: "EXPORT_CONFLICT",
              message:
                "Migration export idempotency key was reused with different content",
            });
          }
          return existing;
        }
        const projectResult = await client.query<LockedProjectRow>(
          `SELECT id::text, name, version, last_sequence, created_at, updated_at, archived_at, saved_snapshot_id
           FROM projects WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR UPDATE`,
          [projectId, actor.workspaceId],
        );
        const project = projectResult.rows[0] ?? exportNotFound();
        if (project.archived_at) {
          throw new AuthServiceError({
            statusCode: 403,
            apiCode: "ACCESS_DENIED",
            message: "Archived projects cannot be exported",
          });
        }
        const version = Number(project.version);
        const sequence = Number(project.last_sequence);
        if (
          (input.expectedVersion !== undefined &&
            input.expectedVersion !== version) ||
          (input.expectedSequence !== undefined &&
            input.expectedSequence !== sequence)
        ) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "PROJECT_VERSION_CONFLICT",
            message: "Project was updated before export preparation",
            details: { currentVersion: version, currentSequence: sequence },
          });
        }
        const graphResult = await client.query<ExportProjectGraphRow>(
          `
          SELECT
            COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', n.node_id, 'nodeType', n.node_type,
              'position', jsonb_build_object('x', n.position_x, 'y', n.position_y),
              'size', CASE WHEN n.width IS NULL OR n.height IS NULL THEN NULL ELSE jsonb_build_object('width', n.width, 'height', n.height) END,
              'zIndex', n.z_index, 'parentNodeId', n.parent_node_id,
              'dataSchemaVersion', n.data_schema_version, 'data', n.data_json, 'presentation', n.presentation_json
            )) ORDER BY n.created_at, n.node_id) FROM project_nodes n WHERE n.project_id = $1 AND n.deleted_at IS NULL), '[]'::jsonb) AS nodes_json,
            COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', e.edge_id, 'source', e.source_node_id, 'target', e.target_node_id,
              'sourceHandle', e.source_handle, 'targetHandle', e.target_handle, 'edgeType', e.edge_type, 'data', e.data_json
            )) ORDER BY e.created_at, e.edge_id) FROM project_edges e WHERE e.project_id = $1 AND e.deleted_at IS NULL), '[]'::jsonb) AS edges_json
        `,
          [projectId],
        );
        const graph = graphResult.rows[0] ?? { nodes_json: [], edges_json: [] };
        const savedResult = project.saved_snapshot_id
          ? await client.query<SavedSnapshotRow>(
              `SELECT id::text, snapshot_type, project_version, last_sequence, created_at, record_json
               FROM project_snapshots WHERE id = $1 AND project_id = $2 AND is_valid FOR SHARE`,
              [project.saved_snapshot_id, projectId],
            )
          : { rows: [] as SavedSnapshotRow[] };
        const saved = savedResult.rows[0];
        const savedAssetIds = saved
          ? assetIdsFromNodes(saved.record_json.canvas.nodes)
          : [];
        const sourceNodes = saved
          ? [...graph.nodes_json, ...saved.record_json.canvas.nodes]
          : graph.nodes_json;
        const assetIds = [...new Set(assetIdsFromNodes(sourceNodes))];
        const assetsResult =
          assetIds.length > 0
            ? await client.query<AssetRow>(
                `SELECT id::text, object_key, original_file_name, mime_type, byte_size, sha256, width, height, asset_kind
               FROM assets WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'completed' AND deleted_at IS NULL
               ORDER BY id FOR SHARE`,
                [actor.workspaceId, assetIds],
              )
            : { rows: [] as AssetRow[] };
        if (
          assetsResult.rows.length !== assetIds.length ||
          assetsResult.rows.some(
            (asset) => !asset.sha256 || !SHA256_PATTERN.test(asset.sha256),
          )
        ) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "ASSET_NOT_READY",
            message: "Project contains an asset that cannot be exported",
          });
        }
        const exportAssets = createPortableAssetFiles(assetsResult.rows);
        const byId = new Map(
          assetsResult.rows.map((asset, index) => [
            asset.id.toLowerCase(),
            exportAssets[index]!,
          ]),
        );
        const byPath = new Map(
          assetsResult.rows.map((asset, index) => [
            `cloud-assets/${asset.id.toLowerCase()}`,
            exportAssets[index]!,
          ]),
        );
        const workingSnapshot = toMigrationSnapshot(
          graph.nodes_json,
          graph.edges_json,
          byId,
          byPath,
        );
        const savedSnapshot = saved
          ? toMigrationSnapshot(
              saved.record_json.canvas.nodes,
              saved.record_json.canvas.edges,
              byId,
              byPath,
            )
          : workingSnapshot;
        const projectRecord: MigrationProjectRecord = {
          id: project.id,
          name: project.name,
          savedSnapshot: savedSnapshot,
          workingSnapshot,
          createdAt: toIso(project.created_at),
          updatedAt: toIso(project.updated_at),
          lastOpenedAt: toIso(project.updated_at),
          archivedAt: project.archived_at ? toIso(project.archived_at) : null,
        };
        const portableGraph: MigrationProjectGraph = {
          schemaVersion: 1,
          projectId: project.id,
          version,
          sequence,
          nodes: workingSnapshot.canvas
            .nodes as unknown as MigrationProjectGraph["nodes"],
          edges: workingSnapshot.canvas
            .edges as unknown as MigrationProjectGraph["edges"],
        };
        const portableAssets = assetsResult.rows.map(
          (asset, index) =>
            ({
              logicalAssetId: exportAssets[index]!.logicalAssetId,
              filePath: exportAssets[index]!.filePath,
              originalFileName: asset.original_file_name,
              mimeType: asset.mime_type,
              byteSize: Number(asset.byte_size),
              sha256: asset.sha256!,
              width: asset.width,
              height: asset.height,
              assetKind: asset.asset_kind,
            }) satisfies MigrationPackageAsset,
        );
        const checkpoint: MigrationPackageCheckpoint | null = saved
          ? {
              schemaVersion: 1,
              id: saved.id,
              projectId: project.id,
              projectVersion: Number(saved.project_version),
              sequence: Number(saved.last_sequence),
              checkpointType: saved.snapshot_type,
              createdAt: toIso(saved.created_at),
              assetIds: savedAssetIds.map(
                (assetId) => byId.get(assetId)?.logicalAssetId ?? assetId,
              ),
              record: {
                schemaVersion: 1,
                project: {
                  id: project.id,
                  name: project.name,
                  version: Number(saved.project_version),
                  lastSequence: Number(saved.last_sequence),
                },
                canvas:
                  savedSnapshot.canvas as unknown as MigrationPackageCheckpoint["record"]["canvas"],
                taskQueue: savedSnapshot.taskQueue,
              },
            }
          : null;
        const jsonFiles = new Map<string, Uint8Array>();
        jsonFiles.set("project.json", canonicalJson(projectRecord));
        jsonFiles.set("graph.json", canonicalJson(portableGraph));
        jsonFiles.set(
          "assets.json",
          canonicalJson({ schemaVersion: 1, assets: portableAssets }),
        );
        if (checkpoint)
          jsonFiles.set("checkpoint.json", canonicalJson(checkpoint));
        const descriptors = [...jsonFiles.entries()].map(([path, body]) => ({
          path,
          byteSize: body.byteLength,
          sha256: createHash("sha256").update(body).digest("hex"),
        }));
        descriptors.push(
          ...portableAssets.map((asset) => ({
            path: asset.filePath,
            byteSize: asset.byteSize,
            sha256: asset.sha256,
          })),
        );
        descriptors.sort((left, right) => left.path.localeCompare(right.path));
        const packageId = randomUUID();
        const manifest: MigrationPackageManifest = {
          packageSchemaVersion: 1,
          packageId,
          sourcePlatform: "cloud",
          exportedAt: new Date().toISOString(),
          project: { id: project.id, version, sequence },
          fileCount: descriptors.length,
          totalByteSize: descriptors.reduce(
            (total, descriptor) => total + descriptor.byteSize,
            0,
          ),
          contentSha256: createHash("sha256")
            .update(
              createMigrationPackageContentDigestInput(descriptors) as string,
            )
            .digest("hex"),
          files: descriptors,
        };
        const manifestBytes = canonicalJson(manifest);
        const totalBytes =
          manifestBytes.byteLength +
          descriptors.reduce(
            (total, descriptor) => total + descriptor.byteSize,
            0,
          );
        const exportAssetsJson = assetsResult.rows.map((_, index) => ({
          ...exportAssets[index]!,
        }));
        const inserted = await client.query<ExportRow>(
          `INSERT INTO migration_exports (
             workspace_id, created_by_user_id, project_id, idempotency_key, request_fingerprint,
             project_name, project_version, project_sequence, file_count, total_bytes,
             manifest_json, project_record_json, graph_json, asset_manifest_json, checkpoint_json, export_assets_json, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, now() + ($17 * interval '1 hour'))
           RETURNING ${EXPORT_COLUMNS}`,
          [
            actor.workspaceId,
            actor.userId,
            project.id,
            input.idempotencyKey,
            fingerprint,
            project.name,
            version,
            sequence,
            descriptors.length + 1,
            totalBytes,
            JSON.stringify(manifest),
            JSON.stringify(projectRecord),
            JSON.stringify(portableGraph),
            JSON.stringify({ schemaVersion: 1, assets: portableAssets }),
            checkpoint ? JSON.stringify(checkpoint) : null,
            JSON.stringify(exportAssetsJson),
            MIGRATION_EXPORT_TTL_HOURS,
          ],
        );
        return inserted.rows[0]!;
      });
      void this.processExport(prepared.id);
      return toResponse(prepared);
    },

    async getExport(rawProjectId, rawExportId, actor) {
      await authorize(actor);
      assertProjectId(rawProjectId);
      const exportId = normalizeExportId(rawExportId);
      return withTransaction(pool, async (client) => {
        const current = await findExport(
          client,
          rawProjectId,
          exportId,
          actor.workspaceId,
          true,
        );
        return toResponse(await expireExport(client, current));
      });
    },

    async cancelExport(rawProjectId, rawExportId, actor) {
      await authorize(actor);
      assertProjectId(rawProjectId);
      const exportId = normalizeExportId(rawExportId);
      return withTransaction(pool, async (client) => {
        const current = await findExport(
          client,
          rawProjectId,
          exportId,
          actor.workspaceId,
          true,
        );
        const expired = await expireExport(client, current);
        if (expired.status === "completed") {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "EXPORT_CONFLICT",
            message: "Completed migration export cannot be canceled",
          });
        }
        if (["canceled", "expired", "failed"].includes(expired.status))
          return toResponse(expired);
        const result = await client.query<ExportRow>(
          expired.status === "generating"
            ? `UPDATE migration_exports SET cancel_requested_at = COALESCE(cancel_requested_at, now()), updated_at = now() WHERE id = $1 RETURNING ${EXPORT_COLUMNS}`
            : `UPDATE migration_exports SET status = 'canceled', cancel_requested_at = COALESCE(cancel_requested_at, now()), canceled_at = COALESCE(canceled_at, now()), updated_at = now() WHERE id = $1 RETURNING ${EXPORT_COLUMNS}`,
          [exportId],
        );
        return toResponse(result.rows[0]!);
      });
    },

    async retryExport(rawProjectId, rawExportId, actor) {
      await authorize(actor, true);
      assertProjectId(rawProjectId);
      const exportId = normalizeExportId(rawExportId);
      let staleArchiveKey: string | null = null;
      const retryColumnAvailable = await supportsRetryColumn(pool);
      const response = await withTransaction(pool, async (client) => {
        const current = await findExport(
          client,
          rawProjectId,
          exportId,
          actor.workspaceId,
          true,
        );
        if (!["failed", "canceled"].includes(current.status)) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "EXPORT_NOT_READY",
            message: "Only failed or canceled migration exports can be retried",
          });
        }
        if (current.retry_count >= MIGRATION_EXPORT_MAX_RETRIES) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "EXPORT_RETRY_EXHAUSTED",
            message: "Migration export retry limit has been reached",
          });
        }
        staleArchiveKey = current.archive_object_key;
        const result = await client.query<ExportRow>(
          `UPDATE migration_exports
           SET status = 'prepared',
               ${retryColumnAvailable ? "retry_count = retry_count + 1," : ""}
               completed_file_count = 0, completed_bytes = 0,
               archive_object_key = NULL, archive_byte_size = NULL, archive_sha256 = NULL,
               error_code = NULL, error_message = NULL,
               cancel_requested_at = NULL, canceled_at = NULL, updated_at = now()
           WHERE id = $1 AND workspace_id = $2 AND project_id = $3
           RETURNING ${EXPORT_COLUMNS}`,
          [exportId, actor.workspaceId, rawProjectId],
        );
        return toResponse(result.rows[0]!);
      });
      if (staleArchiveKey) {
        await objectStorage
          .deleteObject(staleArchiveKey)
          .catch(() => undefined);
      }
      void this.processExport(exportId);
      return response;
    },

    async downloadExport(rawProjectId, rawExportId, actor) {
      await authorize(actor);
      assertProjectId(rawProjectId);
      const exportId = normalizeExportId(rawExportId);
      const row = await pool.query<ExportRow>(
        `SELECT ${EXPORT_COLUMNS} FROM migration_exports WHERE id = $1 AND workspace_id = $2 AND project_id = $3`,
        [exportId, actor.workspaceId, rawProjectId],
      );
      const current = row.rows[0] ?? exportNotFound();
      if (
        new Date(current.expires_at).getTime() <= Date.now() &&
        current.status !== "completed"
      ) {
        throw new AuthServiceError({
          statusCode: 410,
          apiCode: "EXPORT_EXPIRED",
          message: "Migration export has expired",
        });
      }
      if (current.status !== "completed" || !current.archive_object_key) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "EXPORT_NOT_READY",
          message: "Migration export is not ready for download",
        });
      }
      const signed = await objectStorage.createPresignedDownload({
        objectKey: current.archive_object_key,
        expiresInSeconds: MIGRATION_EXPORT_DOWNLOAD_TTL_SECONDS,
      });
      return { exportId, url: signed.url, expiresAt: signed.expiresAt };
    },

    async processExport(exportId) {
      const row = await withTransaction(pool, async (client) => {
        const result = await client.query<ExportRow>(
          `SELECT ${EXPORT_COLUMNS} FROM migration_exports WHERE id = $1 FOR UPDATE`,
          [exportId],
        );
        const current = result.rows[0];
        if (
          !current ||
          ["completed", "canceled", "expired", "failed", "generating"].includes(
            current.status,
          )
        )
          return null;
        const updated = await client.query<ExportRow>(
          `UPDATE migration_exports SET status = 'generating', updated_at = now() WHERE id = $1 AND status = 'prepared' RETURNING ${EXPORT_COLUMNS}`,
          [exportId],
        );
        return updated.rows[0] ?? null;
      });
      if (!row) return;
      let generatedObjectKey: string | null = null;
      try {
        const jsonFiles = new Map<string, Uint8Array>();
        jsonFiles.set("project.json", canonicalJson(row.project_record_json));
        jsonFiles.set("graph.json", canonicalJson(row.graph_json));
        jsonFiles.set("assets.json", canonicalJson(row.asset_manifest_json));
        if (row.checkpoint_json)
          jsonFiles.set("checkpoint.json", canonicalJson(row.checkpoint_json));
        const assetBodies = new Map<string, Uint8Array>();
        let completedFileCount = 1 + jsonFiles.size;
        let completedBytes =
          canonicalJson(row.manifest_json).byteLength +
          [...jsonFiles.values()].reduce(
            (total, body) => total + body.byteLength,
            0,
          );
        await withTransaction(pool, async (client) => {
          await client.query(
            `UPDATE migration_exports SET completed_file_count = $2, completed_bytes = $3, updated_at = now() WHERE id = $1`,
            [exportId, completedFileCount, completedBytes],
          );
        });
        for (const asset of row.export_assets_json) {
          const cancel = (
            await pool.query<{
              cancel_requested_at: Date | null;
              status: ExportRow["status"];
            }>(
              `SELECT cancel_requested_at, status FROM migration_exports WHERE id = $1`,
              [exportId],
            )
          ).rows[0];
          if (
            !cancel ||
            cancel.cancel_requested_at ||
            cancel.status === "canceled"
          ) {
            throw new AuthServiceError({
              statusCode: 409,
              apiCode: "EXPORT_CANCELED",
              message: "Migration export was canceled",
            });
          }
          const body = await objectStorage.getObjectBytes({
            objectKey: asset.objectKey,
            maxBytes: MAX_EXPORT_OBJECT_BYTES,
          });
          if (
            body.byteLength !== asset.byteSize ||
            createHash("sha256").update(body).digest("hex") !== asset.sha256
          ) {
            throw new AuthServiceError({
              statusCode: 422,
              apiCode: "ASSET_VALIDATION_FAILED",
              message: "Project asset changed before export generation",
            });
          }
          assetBodies.set(asset.logicalAssetId, body);
          completedFileCount += 1;
          completedBytes += body.byteLength;
          await pool.query(
            `UPDATE migration_exports SET completed_file_count = $2, completed_bytes = $3, updated_at = now() WHERE id = $1 AND status = 'generating'`,
            [exportId, completedFileCount, completedBytes],
          );
        }
        const built = buildExportPackage({
          manifest: row.manifest_json,
          projectRecord: row.project_record_json,
          graph: row.graph_json,
          assetManifest: row.asset_manifest_json,
          checkpoint: row.checkpoint_json,
          jsonFiles,
          assetBodies,
        });
        const objectKey = `workspaces/${row.workspace_id}/migration-exports/${row.id}/package.zip`;
        generatedObjectKey = objectKey;
        await objectStorage.putObject({
          objectKey,
          mimeType: "application/zip",
          body: built.body,
        });
        const archiveSha256 = createHash("sha256")
          .update(built.body)
          .digest("hex");
        const final = await withTransaction(pool, async (client) => {
          const current = (
            await client.query<ExportRow>(
              `SELECT ${EXPORT_COLUMNS} FROM migration_exports WHERE id = $1 FOR UPDATE`,
              [exportId],
            )
          ).rows[0];
          if (
            !current ||
            current.cancel_requested_at ||
            current.status === "canceled"
          )
            return "canceled" as const;
          await client.query(
            `UPDATE migration_exports SET status = 'completed', completed_file_count = $2, completed_bytes = $3, archive_object_key = $4, archive_byte_size = $5, archive_sha256 = $6, completed_at = now(), updated_at = now() WHERE id = $1`,
            [
              exportId,
              row.file_count,
              Number(row.total_bytes),
              objectKey,
              built.body.byteLength,
              archiveSha256,
            ],
          );
          return "completed" as const;
        });
        if (final === "canceled") {
          await objectStorage.deleteObject(objectKey).catch(() => undefined);
          await pool.query(
            `UPDATE migration_exports SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()), updated_at = now() WHERE id = $1 AND status = 'generating'`,
            [exportId],
          );
        }
      } catch (error) {
        const canceled =
          error instanceof AuthServiceError &&
          error.apiCode === "EXPORT_CANCELED";
        if (generatedObjectKey) {
          await objectStorage
            .deleteObject(generatedObjectKey)
            .catch(() => undefined);
        }
        await pool.query(
          canceled
            ? `UPDATE migration_exports SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()), updated_at = now() WHERE id = $1 AND status <> 'completed'`
            : `UPDATE migration_exports SET status = 'failed', error_code = $2, error_message = $3, updated_at = now() WHERE id = $1 AND status <> 'completed'`,
          canceled
            ? [exportId]
            : [
                exportId,
                error instanceof AuthServiceError
                  ? error.apiCode
                  : "EXPORT_GENERATION_FAILED",
                error instanceof AuthServiceError
                  ? error.message
                  : "Migration export generation failed",
              ],
        );
      }
    },

    async maintainExports(options = {}) {
      const graceHours = options.graceHours ?? MIGRATION_EXPORT_GC_GRACE_HOURS;
      const batchSize = options.batchSize ?? 100;
      if (
        !Number.isInteger(graceHours) ||
        graceHours < 1 ||
        graceHours > 8760 ||
        !Number.isInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > 500
      ) {
        throw new AuthServiceError({
          statusCode: 400,
          apiCode: "VALIDATION_FAILED",
          message: "Invalid migration export maintenance options",
        });
      }
      await pool.query(`
        UPDATE migration_exports
        SET status = 'expired', updated_at = now()
        WHERE expires_at <= now() AND status IN ('prepared', 'generating')
      `);
      const stale = await pool.query<{
        id: string;
        archive_object_key: string | null;
      }>(
        `SELECT id::text, archive_object_key
         FROM migration_exports
         WHERE status IN ('failed', 'canceled', 'expired')
           AND updated_at < now() - ($1 * interval '1 hour')
           AND archive_object_key IS NOT NULL
         ORDER BY updated_at, id
         LIMIT $2`,
        [graceHours, batchSize],
      );
      let cleaned = 0;
      for (const row of stale.rows) {
        if (row.archive_object_key) {
          await objectStorage
            .deleteObject(row.archive_object_key)
            .catch(() => undefined);
        }
        await pool.query(
          `UPDATE migration_exports
           SET archive_object_key = NULL, archive_byte_size = NULL, archive_sha256 = NULL, updated_at = now()
           WHERE id = $1 AND status IN ('failed', 'canceled', 'expired')`,
          [row.id],
        );
        cleaned += 1;
      }
      return cleaned;
    },

    async recoverExports() {
      await this.maintainExports();
      await pool.query(
        `UPDATE migration_exports SET status = 'prepared', updated_at = now() WHERE status = 'generating' AND expires_at > now()`,
      );
      const result = await pool.query<{ id: string }>(
        `SELECT id::text FROM migration_exports WHERE status IN ('prepared', 'generating') AND expires_at > now() ORDER BY created_at, id LIMIT 20`,
      );
      await Promise.all(result.rows.map((row) => this.processExport(row.id)));
    },
  };
}
