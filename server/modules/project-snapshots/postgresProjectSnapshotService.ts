import type {
  ProjectCheckpointResponse,
  ProjectCheckpointSummary,
  ProjectCheckpointType,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphOperation,
  ProjectRevisionRecord,
  ProjectRevisionResponse,
  ProjectRevisionRestoreResponse,
  ProjectRevisionsResponse,
  ProjectSummary,
  WorkspaceRole,
} from "@ai-canvas-cloud/contracts";
import { randomUUID } from "node:crypto";
import {
  withTransaction,
  type DbClient,
  type DbPool,
} from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import {
  collectAssetIdsFromNodeReferenceChanges,
  collectNodeAssetReferenceChangesForNodes,
  normalizeAssetManifest,
  type NodeAssetReferenceChange,
} from "../project-graph/assetReferences.js";
import {
  replaceProjectNodeAssetReferences,
  requireCompletedAssetReferences,
} from "../project-graph/postgresAssetReferences.js";
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from "../workspaces/authorization.js";
import {
  PROJECT_SNAPSHOT_RECORD_SCHEMA_VERSION,
  validateCreateProjectCheckpointRequest,
  validateListProjectRevisionsInput,
  validateProjectRevisionVersion,
  validateRestoreProjectRevisionRequest,
  type ProjectSnapshotService,
} from "./service.js";

const PROJECT_SNAPSHOT_WRITE_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "admin",
  "editor",
];
const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LockedProjectRow {
  id: string;
  name: string;
  version: string | number;
  last_sequence: string | number;
  node_count: number;
  edge_count: number;
  task_count: number;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SnapshotGraphRow {
  nodes_json: ProjectGraphNode[];
  edges_json: ProjectGraphEdge[];
}

interface SnapshotRow {
  id: string;
  project_id: string;
  project_version: string | number;
  last_sequence: string | number;
  snapshot_type: ProjectCheckpointType;
  schema_version: number;
  byte_size: string | number;
  is_valid: boolean;
  created_at: Date | string;
}

interface SnapshotDetailRow extends SnapshotRow {
  record_json: ProjectRevisionRecord;
  asset_manifest_json: unknown;
}

interface RevisionCursor {
  createdAt: string;
  id: string;
}

function toIso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function assertProjectId(projectId: string) {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid project id",
    });
  }
}

function projectNotFound(): never {
  throw new AuthServiceError({
    statusCode: 404,
    apiCode: "RESOURCE_NOT_FOUND",
    message: "Project not found",
  });
}

function toProjectSummary(row: LockedProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    version: Number(row.version),
    lastSequence: Number(row.last_sequence),
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    taskCount: row.task_count,
    archivedAt: row.archived_at ? toIso(row.archived_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toCheckpointSummary(row: SnapshotRow): ProjectCheckpointSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    projectVersion: Number(row.project_version),
    lastSequence: Number(row.last_sequence),
    snapshotType: row.snapshot_type,
    schemaVersion: row.schema_version,
    byteSize: Number(row.byte_size),
    isValid: row.is_valid,
    createdAt: toIso(row.created_at),
  };
}

function revisionNotFound(): never {
  throw new AuthServiceError({
    statusCode: 404,
    apiCode: "RESOURCE_NOT_FOUND",
    message: "Project revision not found",
  });
}

function encodeCursor(revision: ProjectCheckpointSummary) {
  return Buffer.from(
    JSON.stringify({
      createdAt: revision.createdAt,
      id: revision.id,
    } satisfies RevisionCursor),
  ).toString("base64url");
}

function decodeCursor(cursor: string): RevisionCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<RevisionCursor>;

    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !PROJECT_ID_PATTERN.test(parsed.id)
    ) {
      throw new Error("Invalid cursor payload");
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid project revisions cursor",
    });
  }
}

async function readCurrentGraph(client: DbClient, projectId: string) {
  const result = await client.query<SnapshotGraphRow>(
    `
      SELECT
        COALESCE((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', n.node_id,
            'nodeType', n.node_type,
            'position', jsonb_build_object('x', n.position_x, 'y', n.position_y),
            'size', CASE WHEN n.width IS NULL OR n.height IS NULL THEN NULL
              ELSE jsonb_build_object('width', n.width, 'height', n.height) END,
            'zIndex', n.z_index,
            'parentNodeId', n.parent_node_id,
            'dataSchemaVersion', n.data_schema_version,
            'data', n.data_json,
            'presentation', n.presentation_json
          )) ORDER BY n.created_at, n.node_id)
          FROM project_nodes n
          WHERE n.project_id = $1 AND n.deleted_at IS NULL
        ), '[]'::jsonb) AS nodes_json,
        COALESCE((
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', e.edge_id,
            'source', e.source_node_id,
            'target', e.target_node_id,
            'sourceHandle', e.source_handle,
            'targetHandle', e.target_handle,
            'edgeType', e.edge_type,
            'data', e.data_json
          )) ORDER BY e.created_at, e.edge_id)
          FROM project_edges e
          WHERE e.project_id = $1 AND e.deleted_at IS NULL
        ), '[]'::jsonb) AS edges_json
    `,
    [projectId],
  );

  return result.rows[0] ?? { nodes_json: [], edges_json: [] };
}

function createSnapshotRecord(
  project: LockedProjectRow,
  graph: SnapshotGraphRow,
): ProjectRevisionRecord {
  return {
    schemaVersion: PROJECT_SNAPSHOT_RECORD_SCHEMA_VERSION,
    project: {
      id: project.id,
      name: project.name,
      version: Number(project.version),
      lastSequence: Number(project.last_sequence),
    },
    canvas: {
      nodes: graph.nodes_json,
      edges: graph.edges_json,
    },
    taskQueue: {
      tasks: [],
    },
  };
}

function collectSnapshotAssetReferenceChanges(nodes: ProjectGraphNode[]) {
  try {
    return collectNodeAssetReferenceChangesForNodes(nodes);
  } catch (error) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: "VALIDATION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Checkpoint contains invalid asset references",
    });
  }
}

function validateSnapshotAssetManifest(
  value: unknown,
  changes: NodeAssetReferenceChange[],
) {
  let storedAssetIds: string[];
  try {
    storedAssetIds = normalizeAssetManifest(value);
  } catch (error) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: "VALIDATION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Checkpoint asset manifest is invalid",
    });
  }

  const derivedAssetIds = collectAssetIdsFromNodeReferenceChanges(changes);
  if (
    storedAssetIds.length !== derivedAssetIds.length ||
    storedAssetIds.some((assetId, index) => assetId !== derivedAssetIds[index])
  ) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: "VALIDATION_FAILED",
      message: "Checkpoint asset manifest does not match its graph record",
    });
  }
}

async function insertSnapshot(
  client: DbClient,
  projectId: string,
  projectVersion: number,
  lastSequence: number,
  snapshotType: ProjectCheckpointType,
  record: ProjectRevisionRecord,
  assetManifest: string[],
) {
  const recordJson = JSON.stringify(record);
  const byteSize = Buffer.byteLength(recordJson, "utf8");
  const snapshotResult = await client.query<SnapshotRow>(
    `
      INSERT INTO project_snapshots (
        project_id,
        project_version,
        last_sequence,
        snapshot_type,
        schema_version,
        record_json,
        byte_size,
        asset_manifest_json,
        is_valid
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, true)
      RETURNING
        id::text,
        project_id::text,
        project_version,
        last_sequence,
        snapshot_type,
        schema_version,
        byte_size,
        is_valid,
        created_at
    `,
    [
      projectId,
      projectVersion,
      lastSequence,
      snapshotType,
      PROJECT_SNAPSHOT_RECORD_SCHEMA_VERSION,
      recordJson,
      byteSize,
      JSON.stringify(assetManifest),
    ],
  );

  return snapshotResult.rows[0]!;
}

export async function insertImportCheckpointTransaction(
  client: DbClient,
  input: {
    projectId: string;
    projectName: string;
    projectVersion: number;
    sequence: number;
    nodes: ProjectGraphNode[];
    edges: ProjectGraphEdge[];
    taskQueue: { tasks: Record<string, unknown>[] };
    assetManifest: string[];
  },
) {
  const record: ProjectRevisionRecord = {
    schemaVersion: PROJECT_SNAPSHOT_RECORD_SCHEMA_VERSION,
    project: {
      id: input.projectId,
      name: input.projectName,
      version: input.projectVersion,
      lastSequence: input.sequence,
    },
    canvas: {
      nodes: input.nodes,
      edges: input.edges,
    },
    taskQueue: input.taskQueue,
  };
  validateRevisionRecord(record, input.projectId);
  await requireCompletedAssetReferences(
    client,
    (
      await client.query<{ workspace_id: string }>(
        `SELECT workspace_id::text FROM projects WHERE id = $1`,
        [input.projectId],
      )
    ).rows[0]?.workspace_id ?? "",
    collectNodeAssetReferenceChangesForNodes(input.nodes),
  );
  const snapshot = await insertSnapshot(
    client,
    input.projectId,
    input.projectVersion,
    input.sequence,
    "import",
    record,
    input.assetManifest,
  );
  return {
    id: snapshot.id,
    projectVersion: Number(snapshot.project_version),
    sequence: Number(snapshot.last_sequence),
  };
}

async function findReusableManualSnapshot(
  client: DbClient,
  projectId: string,
  projectVersion: number,
  lastSequence: number,
  assetManifest: string[],
) {
  const result = await client.query<SnapshotRow>(
    `
      SELECT
        id::text,
        project_id::text,
        project_version,
        last_sequence,
        snapshot_type,
        schema_version,
        byte_size,
        is_valid,
        created_at
      FROM project_snapshots
      WHERE project_id = $1
        AND project_version = $2
        AND last_sequence = $3
        AND snapshot_type = 'manual'
        AND is_valid
        AND asset_manifest_json = $4::jsonb
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [projectId, projectVersion, lastSequence, JSON.stringify(assetManifest)],
  );

  return result.rows[0] ?? null;
}

function validateRevisionRecord(
  record: ProjectRevisionRecord,
  projectId: string,
) {
  if (
    !record ||
    record.schemaVersion !== PROJECT_SNAPSHOT_RECORD_SCHEMA_VERSION ||
    record.project?.id !== projectId ||
    !Array.isArray(record.canvas?.nodes) ||
    !Array.isArray(record.canvas?.edges)
  ) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: "VALIDATION_FAILED",
      message: "Project revision record is not restorable",
    });
  }
}

function buildRestoreOperations(
  current: SnapshotGraphRow,
  target: ProjectRevisionRecord,
): ProjectGraphOperation[] {
  const targetNodeIds = new Set(target.canvas.nodes.map((node) => node.id));
  const targetEdgeIds = new Set(target.canvas.edges.map((edge) => edge.id));
  const operations: ProjectGraphOperation[] = [];

  for (const edge of current.edges_json) {
    if (!targetEdgeIds.has(edge.id)) {
      operations.push({ type: "deleteEdge", edgeId: edge.id });
    }
  }

  for (const node of current.nodes_json) {
    if (!targetNodeIds.has(node.id)) {
      operations.push({ type: "deleteNode", nodeId: node.id });
    }
  }

  for (const node of target.canvas.nodes) {
    operations.push({ type: "upsertNode", node });
  }

  for (const edge of target.canvas.edges) {
    operations.push({ type: "upsertEdge", edge });
  }

  return operations;
}

async function replaceCurrentGraph(
  client: DbClient,
  projectId: string,
  record: ProjectRevisionRecord,
) {
  await client.query(
    `
      UPDATE project_edges
      SET deleted_at = COALESCE(deleted_at, now()),
          row_version = CASE WHEN deleted_at IS NULL THEN row_version + 1 ELSE row_version END,
          updated_at = CASE WHEN deleted_at IS NULL THEN now() ELSE updated_at END
      WHERE project_id = $1
    `,
    [projectId],
  );
  await client.query(
    `
      UPDATE project_nodes
      SET deleted_at = COALESCE(deleted_at, now()),
          row_version = CASE WHEN deleted_at IS NULL THEN row_version + 1 ELSE row_version END,
          updated_at = CASE WHEN deleted_at IS NULL THEN now() ELSE updated_at END
      WHERE project_id = $1
    `,
    [projectId],
  );

  for (const node of record.canvas.nodes) {
    await client.query(
      `
        INSERT INTO project_nodes (
          project_id, node_id, node_type, position_x, position_y, width, height,
          z_index, parent_node_id, data_schema_version, data_json, presentation_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
        ON CONFLICT (project_id, node_id) DO UPDATE
        SET node_type = EXCLUDED.node_type,
            position_x = EXCLUDED.position_x,
            position_y = EXCLUDED.position_y,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            z_index = EXCLUDED.z_index,
            parent_node_id = EXCLUDED.parent_node_id,
            row_version = project_nodes.row_version + 1,
            data_schema_version = EXCLUDED.data_schema_version,
            data_json = EXCLUDED.data_json,
            presentation_json = EXCLUDED.presentation_json,
            deleted_at = NULL,
            updated_at = now()
      `,
      [
        projectId,
        node.id,
        node.nodeType,
        node.position.x,
        node.position.y,
        node.size?.width ?? null,
        node.size?.height ?? null,
        node.zIndex ?? 0,
        node.parentNodeId ?? null,
        node.dataSchemaVersion,
        JSON.stringify(node.data),
        JSON.stringify(node.presentation ?? {}),
      ],
    );
  }

  for (const edge of record.canvas.edges) {
    await client.query(
      `
        INSERT INTO project_edges (
          project_id, edge_id, source_node_id, target_node_id,
          source_handle, target_handle, edge_type, data_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (project_id, edge_id) DO UPDATE
        SET source_node_id = EXCLUDED.source_node_id,
            target_node_id = EXCLUDED.target_node_id,
            source_handle = EXCLUDED.source_handle,
            target_handle = EXCLUDED.target_handle,
            edge_type = EXCLUDED.edge_type,
            row_version = project_edges.row_version + 1,
            data_json = EXCLUDED.data_json,
            deleted_at = NULL,
            updated_at = now()
      `,
      [
        projectId,
        edge.id,
        edge.source,
        edge.target,
        edge.sourceHandle ?? null,
        edge.targetHandle ?? null,
        edge.edgeType ?? null,
        JSON.stringify(edge.data ?? {}),
      ],
    );
  }
}

export function createPostgresProjectSnapshotService(
  pool: DbPool,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): ProjectSnapshotService {
  const authorizationService =
    options.authorizationService ?? createWorkspaceAuthorizationService(pool);

  return {
    async listRevisions(projectId, rawInput, actor) {
      assertProjectId(projectId);
      const input = validateListProjectRevisionsInput(rawInput);
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      });

      const projectResult = await pool.query<{ id: string }>(
        `
          SELECT id::text
          FROM projects
          WHERE id = $1
            AND workspace_id = $2
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [projectId, actor.workspaceId],
      );
      if (!projectResult.rows[0]) {
        projectNotFound();
      }

      const values: unknown[] = [projectId];
      let cursorClause = "";
      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        values.push(cursor.createdAt, cursor.id);
        cursorClause = `AND (created_at, id) < ($2::timestamptz, $3::uuid)`;
      }

      values.push(input.limit + 1);
      const result = await pool.query<SnapshotRow>(
        `
          SELECT
            id::text,
            project_id::text,
            project_version,
            last_sequence,
            snapshot_type,
            schema_version,
            byte_size,
            is_valid,
            created_at
          FROM project_snapshots
          WHERE project_id = $1
            ${cursorClause}
          ORDER BY created_at DESC, id DESC
          LIMIT $${values.length}
        `,
        values,
      );
      const hasNextPage = result.rows.length > input.limit;
      const revisions = result.rows
        .slice(0, input.limit)
        .map(toCheckpointSummary);

      return {
        revisions,
        nextCursor:
          hasNextPage && revisions.length > 0
            ? encodeCursor(revisions[revisions.length - 1]!)
            : null,
      } satisfies ProjectRevisionsResponse;
    },

    async getRevision(projectId, rawVersion, actor) {
      assertProjectId(projectId);
      const version = validateProjectRevisionVersion(rawVersion);
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      });

      const result = await pool.query<SnapshotDetailRow>(
        `
          SELECT
            s.id::text,
            s.project_id::text,
            s.project_version,
            s.last_sequence,
            s.snapshot_type,
            s.schema_version,
            s.byte_size,
            s.is_valid,
            s.created_at,
            s.record_json,
            s.asset_manifest_json
          FROM project_snapshots s
          JOIN projects p ON p.id = s.project_id
          WHERE s.project_id = $1
            AND s.project_version = $2
            AND p.workspace_id = $3
            AND p.deleted_at IS NULL
          ORDER BY s.created_at DESC, s.id DESC
          LIMIT 1
        `,
        [projectId, version, actor.workspaceId],
      );
      const revision = result.rows[0] ?? revisionNotFound();

      return {
        checkpoint: toCheckpointSummary(revision),
        record: revision.record_json,
      } satisfies ProjectRevisionResponse;
    },

    async createCheckpoint(projectId, rawInput, actor) {
      assertProjectId(projectId);
      const input = validateCreateProjectCheckpointRequest(rawInput);
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: PROJECT_SNAPSHOT_WRITE_ROLES,
      });

      return withTransaction(pool, async (client) => {
        const projectResult = await client.query<LockedProjectRow>(
          `
            SELECT
              id::text AS id,
              name,
              version,
              last_sequence,
              node_count,
              edge_count,
              task_count,
              archived_at,
              created_at,
              updated_at
            FROM projects
            WHERE id = $1
              AND workspace_id = $2
              AND deleted_at IS NULL
            FOR UPDATE
          `,
          [projectId, actor.workspaceId],
        );
        const project = projectResult.rows[0] ?? projectNotFound();

        if (project.archived_at) {
          throw new AuthServiceError({
            statusCode: 403,
            apiCode: "ACCESS_DENIED",
            message: "Archived projects cannot create checkpoints",
          });
        }

        const currentVersion = Number(project.version);
        const currentSequence = Number(project.last_sequence);
        if (
          currentVersion !== input.expectedVersion ||
          currentSequence !== input.expectedSequence
        ) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "PROJECT_VERSION_CONFLICT",
            message: "Project was updated before checkpoint creation",
            details: { currentVersion, currentSequence },
          });
        }

        const graph = await readCurrentGraph(client, projectId);
        const assetReferenceChanges = collectSnapshotAssetReferenceChanges(
          graph.nodes_json,
        );
        const assetManifest = collectAssetIdsFromNodeReferenceChanges(
          assetReferenceChanges,
        );

        if (input.checkpointType === "manual") {
          const existing = await findReusableManualSnapshot(
            client,
            projectId,
            currentVersion,
            currentSequence,
            assetManifest,
          );
          if (existing) {
            return {
              checkpoint: toCheckpointSummary(existing),
              project: toProjectSummary(project),
            } satisfies ProjectCheckpointResponse;
          }
        }

        await requireCompletedAssetReferences(
          client,
          actor.workspaceId,
          assetReferenceChanges,
        );
        const snapshot = await insertSnapshot(
          client,
          projectId,
          currentVersion,
          currentSequence,
          input.checkpointType,
          createSnapshotRecord(project, graph),
          assetManifest,
        );
        const updatedProject =
          input.checkpointType === "manual"
            ? (
                await client.query<LockedProjectRow>(
                  `
                UPDATE projects
                SET saved_snapshot_id = $3,
                    updated_at = $4
                WHERE id = $1
                  AND workspace_id = $2
                  AND deleted_at IS NULL
                RETURNING
                  id::text AS id,
                  name,
                  version,
                  last_sequence,
                  node_count,
                  edge_count,
                  task_count,
                  archived_at,
                  created_at,
                  updated_at
              `,
                  [
                    projectId,
                    actor.workspaceId,
                    snapshot.id,
                    snapshot.created_at,
                  ],
                )
              ).rows[0]
            : project;

        return {
          checkpoint: toCheckpointSummary(snapshot),
          project: toProjectSummary(updatedProject ?? project),
        } satisfies ProjectCheckpointResponse;
      });
    },

    async restoreRevision(projectId, rawVersion, rawInput, actor) {
      assertProjectId(projectId);
      const version = validateProjectRevisionVersion(rawVersion);
      const input = validateRestoreProjectRevisionRequest(rawInput);
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: PROJECT_SNAPSHOT_WRITE_ROLES,
      });

      return withTransaction(pool, async (client) => {
        const projectResult = await client.query<LockedProjectRow>(
          `
            SELECT
              id::text AS id,
              name,
              version,
              last_sequence,
              node_count,
              edge_count,
              task_count,
              archived_at,
              created_at,
              updated_at
            FROM projects
            WHERE id = $1
              AND workspace_id = $2
              AND deleted_at IS NULL
            FOR UPDATE
          `,
          [projectId, actor.workspaceId],
        );
        const project = projectResult.rows[0] ?? projectNotFound();

        if (project.archived_at) {
          throw new AuthServiceError({
            statusCode: 403,
            apiCode: "ACCESS_DENIED",
            message: "Archived projects cannot be restored from revisions",
          });
        }

        const currentVersion = Number(project.version);
        const currentSequence = Number(project.last_sequence);
        if (
          currentVersion !== input.expectedVersion ||
          currentSequence !== input.expectedSequence
        ) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: "PROJECT_VERSION_CONFLICT",
            message: "Project was updated before revision restore",
            details: { currentVersion, currentSequence },
          });
        }

        const targetResult = await client.query<SnapshotDetailRow>(
          `
            SELECT
              id::text,
              project_id::text,
              project_version,
              last_sequence,
              snapshot_type,
              schema_version,
              byte_size,
              is_valid,
              created_at,
              record_json,
              asset_manifest_json
            FROM project_snapshots
            WHERE project_id = $1
              AND project_version = $2
              AND is_valid
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          `,
          [projectId, version],
        );
        const targetSnapshot = targetResult.rows[0] ?? revisionNotFound();
        validateRevisionRecord(targetSnapshot.record_json, projectId);
        const targetAssetReferenceChanges =
          collectSnapshotAssetReferenceChanges(
            targetSnapshot.record_json.canvas.nodes,
          );
        validateSnapshotAssetManifest(
          targetSnapshot.asset_manifest_json,
          targetAssetReferenceChanges,
        );
        await requireCompletedAssetReferences(
          client,
          actor.workspaceId,
          targetAssetReferenceChanges,
        );

        const currentGraph = await readCurrentGraph(client, projectId);
        const currentAssetReferenceChanges =
          collectSnapshotAssetReferenceChanges(currentGraph.nodes_json);
        const currentAssetManifest = await requireCompletedAssetReferences(
          client,
          actor.workspaceId,
          currentAssetReferenceChanges,
        );
        const preRestoreSnapshot = await insertSnapshot(
          client,
          projectId,
          currentVersion,
          currentSequence,
          "pre_restore",
          createSnapshotRecord(project, currentGraph),
          currentAssetManifest,
        );
        const operations = buildRestoreOperations(
          currentGraph,
          targetSnapshot.record_json,
        );

        await replaceCurrentGraph(
          client,
          projectId,
          targetSnapshot.record_json,
        );
        await replaceProjectNodeAssetReferences(
          client,
          actor.workspaceId,
          projectId,
          targetAssetReferenceChanges,
        );

        const countsResult = await client.query<{
          node_count: number;
          edge_count: number;
        }>(
          `
            SELECT
              (SELECT count(*)::integer FROM project_nodes WHERE project_id = $1 AND deleted_at IS NULL) AS node_count,
              (SELECT count(*)::integer FROM project_edges WHERE project_id = $1 AND deleted_at IS NULL) AS edge_count
          `,
          [projectId],
        );
        const counts = countsResult.rows[0]!;
        const resultVersion = currentVersion + 1;
        const sequence = currentSequence + 1;
        const requestId = randomUUID();
        const changeResult = await client.query<{ created_at: Date | string }>(
          `
            INSERT INTO project_changes (
              project_id, sequence, base_version, result_version, actor_user_id,
              client_id, batch_id, idempotency_key, source, operations_json
            ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'restore', $8::jsonb)
            RETURNING created_at
          `,
          [
            projectId,
            sequence,
            currentVersion,
            resultVersion,
            actor.userId,
            `restore_${requestId}`,
            `restore_${requestId}`,
            JSON.stringify(operations),
          ],
        );
        const updatedAt = changeResult.rows[0]!.created_at;
        const updatedProjectResult = await client.query<LockedProjectRow>(
          `
            UPDATE projects
            SET version = $3,
                last_sequence = $4,
                saved_snapshot_id = $5,
                node_count = $6,
                edge_count = $7,
                updated_at = $8
            WHERE id = $1
              AND workspace_id = $2
              AND deleted_at IS NULL
            RETURNING
              id::text AS id,
              name,
              version,
              last_sequence,
              node_count,
              edge_count,
              task_count,
              archived_at,
              created_at,
              updated_at
          `,
          [
            projectId,
            actor.workspaceId,
            resultVersion,
            sequence,
            targetSnapshot.id,
            counts.node_count,
            counts.edge_count,
            updatedAt,
          ],
        );

        return {
          restoredCheckpoint: toCheckpointSummary(targetSnapshot),
          preRestoreCheckpoint: toCheckpointSummary(preRestoreSnapshot),
          project: toProjectSummary(
            updatedProjectResult.rows[0] ?? {
              ...project,
              version: resultVersion,
              last_sequence: sequence,
              node_count: counts.node_count,
              edge_count: counts.edge_count,
              updated_at: updatedAt,
            },
          ),
          version: resultVersion,
          sequence,
        } satisfies ProjectRevisionRestoreResponse;
      });
    },
  };
}
