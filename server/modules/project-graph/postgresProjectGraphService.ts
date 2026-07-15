import type {
  ApplyProjectGraphOperationsResponse,
  ProjectGraphChange,
  ProjectGraphChangeSource,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphOperation,
  ProjectGraphChangesResponse,
  ProjectGraphResponse,
  WorkspaceRole,
} from '@ai-canvas-cloud/contracts'
import { withTransaction, type DbClient, type DbPool } from '../../db/postgres.js'
import { AuthServiceError } from '../auth/service.js'
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from '../workspaces/authorization.js'
import {
  PROJECT_GRAPH_CHANGES_PAGE_SIZE,
  validateApplyProjectGraphOperationsRequest,
  validateProjectGraphChangesAfter,
  type ProjectGraphService,
} from './service.js'

const PROJECT_GRAPH_WRITE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'editor']
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface GraphRow {
  project_id: string
  version: string | number
  last_sequence: string | number
  nodes_json: ProjectGraphNode[]
  edges_json: ProjectGraphEdge[]
}

interface LockedProjectRow {
  id: string
  version: string | number
  last_sequence: string | number
  archived_at: Date | string | null
}

interface ExistingChangeRow {
  base_version: string | number
  result_version: string | number
  sequence: string | number
  actor_user_id: string | null
  client_id: string | null
  batch_id: string
  idempotency_key: string
  operations_match: boolean
  created_at: Date | string
}

interface ChangeRow {
  sequence: string | number
  base_version: string | number
  result_version: string | number
  client_id: string | null
  batch_id: string
  source: ProjectGraphChangeSource
  operations_json: ProjectGraphOperation[]
  created_at: Date | string
}

interface ActiveNodeRow {
  node_id: string
  parent_node_id: string | null
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function assertProjectId(projectId: string) {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Invalid project id',
    })
  }
}

function projectNotFound(): never {
  throw new AuthServiceError({
    statusCode: 404,
    apiCode: 'RESOURCE_NOT_FOUND',
    message: 'Project not found',
  })
}

function validateNodeTopology(rows: ActiveNodeRow[], operations: ProjectGraphOperation[]) {
  const parents = new Map(rows.map((row) => [row.node_id, row.parent_node_id]))

  for (const operation of operations) {
    if (operation.type === 'upsertNode') {
      parents.set(operation.node.id, operation.node.parentNodeId ?? null)
    } else if (operation.type === 'deleteNode') {
      parents.delete(operation.nodeId)
    }
  }

  for (const [nodeId, parentNodeId] of parents) {
    if (parentNodeId && !parents.has(parentNodeId)) {
      throw new AuthServiceError({
        statusCode: 400,
        apiCode: 'VALIDATION_FAILED',
        message: `Node ${nodeId} references a missing parent`,
      })
    }
  }

  const resolved = new Set<string>()

  for (const nodeId of parents.keys()) {
    const path = new Set<string>()
    let currentNodeId: string | null = nodeId

    while (currentNodeId && !resolved.has(currentNodeId)) {
      if (path.has(currentNodeId)) {
        throw new AuthServiceError({
          statusCode: 400,
          apiCode: 'VALIDATION_FAILED',
          message: 'Project node parent relationship contains a cycle',
        })
      }

      path.add(currentNodeId)
      currentNodeId = parents.get(currentNodeId) ?? null
    }

    for (const resolvedNodeId of path) {
      resolved.add(resolvedNodeId)
    }
  }

  return parents
}

function validateEdgeEndpoints(activeNodes: ReadonlyMap<string, string | null>, operations: ProjectGraphOperation[]) {
  for (const operation of operations) {
    if (operation.type !== 'upsertEdge') {
      continue
    }

    if (!activeNodes.has(operation.edge.source) || !activeNodes.has(operation.edge.target)) {
      throw new AuthServiceError({
        statusCode: 400,
        apiCode: 'VALIDATION_FAILED',
        message: `Edge ${operation.edge.id} references a missing node`,
      })
    }
  }
}

async function applyNodeOperation(client: DbClient, projectId: string, operation: ProjectGraphOperation) {
  if (operation.type === 'upsertNode') {
    const node = operation.node
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
    )
    return
  }

  if (operation.type === 'deleteNode') {
    await client.query(
      `
        UPDATE project_edges
        SET deleted_at = COALESCE(deleted_at, now()),
            row_version = CASE WHEN deleted_at IS NULL THEN row_version + 1 ELSE row_version END,
            updated_at = CASE WHEN deleted_at IS NULL THEN now() ELSE updated_at END
        WHERE project_id = $1
          AND (source_node_id = $2 OR target_node_id = $2)
      `,
      [projectId, operation.nodeId],
    )
    await client.query(
      `
        UPDATE project_nodes
        SET deleted_at = COALESCE(deleted_at, now()),
            row_version = CASE WHEN deleted_at IS NULL THEN row_version + 1 ELSE row_version END,
            updated_at = CASE WHEN deleted_at IS NULL THEN now() ELSE updated_at END
        WHERE project_id = $1 AND node_id = $2
      `,
      [projectId, operation.nodeId],
    )
  }
}

async function applyEdgeOperation(client: DbClient, projectId: string, operation: ProjectGraphOperation) {
  if (operation.type === 'upsertEdge') {
    const edge = operation.edge
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
    )
    return
  }

  if (operation.type === 'deleteEdge') {
    await client.query(
      `
        UPDATE project_edges
        SET deleted_at = COALESCE(deleted_at, now()),
            row_version = CASE WHEN deleted_at IS NULL THEN row_version + 1 ELSE row_version END,
            updated_at = CASE WHEN deleted_at IS NULL THEN now() ELSE updated_at END
        WHERE project_id = $1 AND edge_id = $2
      `,
      [projectId, operation.edgeId],
    )
  }
}

function toIdempotentResponse(projectId: string, change: ExistingChangeRow): ApplyProjectGraphOperationsResponse {
  return {
    projectId,
    version: Number(change.result_version),
    sequence: Number(change.sequence),
    acceptedBatchId: change.batch_id,
    updatedAt: toIso(change.created_at),
  }
}

export function createPostgresProjectGraphService(
  pool: DbPool,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): ProjectGraphService {
  const authorizationService = options.authorizationService ?? createWorkspaceAuthorizationService(pool)

  return {
    async getGraph(projectId, actor) {
      assertProjectId(projectId)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      })
      const result = await pool.query<GraphRow>(
        `
          SELECT
            p.id::text AS project_id,
            p.version,
            p.last_sequence,
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
              WHERE n.project_id = p.id AND n.deleted_at IS NULL
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
              WHERE e.project_id = p.id AND e.deleted_at IS NULL
            ), '[]'::jsonb) AS edges_json
          FROM projects p
          WHERE p.id = $1
            AND p.workspace_id = $2
            AND p.deleted_at IS NULL
          LIMIT 1
        `,
        [projectId, actor.workspaceId],
      )
      const row = result.rows[0] ?? projectNotFound()

      return {
        projectId: row.project_id,
        version: Number(row.version),
        sequence: Number(row.last_sequence),
        nodes: row.nodes_json,
        edges: row.edges_json,
      } satisfies ProjectGraphResponse
    },

    async getChanges(projectId, rawAfter, actor) {
      assertProjectId(projectId)
      const after = validateProjectGraphChangesAfter(rawAfter)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      })

      const projectResult = await pool.query<{
        project_id: string
        version: string | number
        last_sequence: string | number
      }>(
        `
          SELECT id::text AS project_id, version, last_sequence
          FROM projects
          WHERE id = $1
            AND workspace_id = $2
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [projectId, actor.workspaceId],
      )
      const project = projectResult.rows[0] ?? projectNotFound()
      const changeResult = await pool.query<ChangeRow>(
        `
          SELECT
            sequence,
            base_version,
            result_version,
            client_id,
            batch_id,
            source,
            operations_json,
            created_at
          FROM project_changes
          WHERE project_id = $1
            AND sequence > $2
          ORDER BY sequence ASC
          LIMIT $3
        `,
        [projectId, after, PROJECT_GRAPH_CHANGES_PAGE_SIZE],
      )
      const changes: ProjectGraphChange[] = changeResult.rows.map((row) => ({
        sequence: Number(row.sequence),
        baseVersion: Number(row.base_version),
        resultVersion: Number(row.result_version),
        clientId: row.client_id,
        batchId: row.batch_id,
        source: row.source,
        operations: row.operations_json,
        createdAt: toIso(row.created_at),
      }))
      const lastReturnedSequence = changes.at(-1)?.sequence ?? after

      return {
        projectId: project.project_id,
        version: Number(project.version),
        sequence: Number(project.last_sequence),
        after,
        changes,
        hasMore: Number(project.last_sequence) > lastReturnedSequence,
      } satisfies ProjectGraphChangesResponse
    },

    async applyOperations(projectId, rawInput, actor) {
      assertProjectId(projectId)
      const input = validateApplyProjectGraphOperationsRequest(rawInput)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: PROJECT_GRAPH_WRITE_ROLES,
      })

      return withTransaction(pool, async (client) => {
        const projectResult = await client.query<LockedProjectRow>(
          `
            SELECT id::text, version, last_sequence, archived_at
            FROM projects
            WHERE id = $1
              AND workspace_id = $2
              AND deleted_at IS NULL
            FOR UPDATE
          `,
          [projectId, actor.workspaceId],
        )
        const project = projectResult.rows[0] ?? projectNotFound()

        const operationsJson = JSON.stringify(input.operations)
        const existingResult = await client.query<ExistingChangeRow>(
          `
            SELECT
              base_version,
              result_version,
              sequence,
              actor_user_id,
              client_id,
              batch_id,
              idempotency_key,
              operations_json = $4::jsonb AS operations_match,
              created_at
            FROM project_changes
            WHERE project_id = $1
              AND (idempotency_key = $2 OR batch_id = $3)
            LIMIT 1
          `,
          [projectId, input.idempotencyKey, input.batchId, operationsJson],
        )
        const existing = existingResult.rows[0]

        if (existing) {
          const matches = existing.idempotency_key === input.idempotencyKey
            && existing.batch_id === input.batchId
            && existing.client_id === input.clientId
            && existing.actor_user_id === actor.userId
            && Number(existing.base_version) === input.baseVersion
            && existing.operations_match

          if (matches) {
            return toIdempotentResponse(projectId, existing)
          }

          throw new AuthServiceError({
            statusCode: 409,
            apiCode: 'VALIDATION_FAILED',
            message: 'Idempotency key or batch id was already used for another request',
          })
        }

        if (project.archived_at) {
          throw new AuthServiceError({
            statusCode: 403,
            apiCode: 'ACCESS_DENIED',
            message: 'Archived projects cannot be edited',
          })
        }

        const currentVersion = Number(project.version)
        if (currentVersion !== input.baseVersion) {
          throw new AuthServiceError({
            statusCode: 409,
            apiCode: 'PROJECT_VERSION_CONFLICT',
            message: 'Project was updated by another client',
            details: { currentVersion },
          })
        }

        const nodeResult = await client.query<ActiveNodeRow>(
          `SELECT node_id, parent_node_id FROM project_nodes WHERE project_id = $1 AND deleted_at IS NULL`,
          [projectId],
        )
        const activeNodes = validateNodeTopology(nodeResult.rows, input.operations)
        validateEdgeEndpoints(activeNodes, input.operations)

        for (const operation of input.operations) {
          if (operation.type === 'upsertNode' || operation.type === 'deleteNode') {
            await applyNodeOperation(client, projectId, operation)
          }
        }
        for (const operation of input.operations) {
          if (operation.type === 'upsertEdge' || operation.type === 'deleteEdge') {
            await applyEdgeOperation(client, projectId, operation)
          }
        }

        const countResult = await client.query<{ node_count: number; edge_count: number }>(
          `
            SELECT
              (SELECT count(*)::integer FROM project_nodes WHERE project_id = $1 AND deleted_at IS NULL) AS node_count,
              (SELECT count(*)::integer FROM project_edges WHERE project_id = $1 AND deleted_at IS NULL) AS edge_count
          `,
          [projectId],
        )
        const counts = countResult.rows[0]!
        const resultVersion = currentVersion + 1
        const sequence = Number(project.last_sequence) + 1
        const changeResult = await client.query<{ created_at: Date | string }>(
          `
            INSERT INTO project_changes (
              project_id, sequence, base_version, result_version, actor_user_id,
              client_id, batch_id, idempotency_key, source, operations_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user', $9::jsonb)
            RETURNING created_at
          `,
          [
            projectId,
            sequence,
            currentVersion,
            resultVersion,
            actor.userId,
            input.clientId,
            input.batchId,
            input.idempotencyKey,
            operationsJson,
          ],
        )
        const updatedAt = changeResult.rows[0]!.created_at

        await client.query(
          `
            UPDATE projects
            SET version = $3,
                last_sequence = $4,
                node_count = $5,
                edge_count = $6,
                updated_at = $7
            WHERE id = $1 AND workspace_id = $2 AND version = $8
          `,
          [
            projectId,
            actor.workspaceId,
            resultVersion,
            sequence,
            counts.node_count,
            counts.edge_count,
            updatedAt,
            currentVersion,
          ],
        )

        return {
          projectId,
          version: resultVersion,
          sequence,
          acceptedBatchId: input.batchId,
          updatedAt: toIso(updatedAt),
        }
      })
    },
  }
}
