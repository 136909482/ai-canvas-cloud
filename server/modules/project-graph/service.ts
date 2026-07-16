import type {
  ApplyProjectGraphOperationsRequest,
  ApplyProjectGraphOperationsResponse,
  ProjectGraphEdge,
  ProjectGraphChangesResponse,
  ProjectGraphNode,
  ProjectGraphOperation,
  ProjectGraphResponse,
} from '@ai-canvas-cloud/contracts'
import { AuthServiceError } from '../auth/service.js'
import type { ProjectActor } from '../projects/service.js'

export const PROJECT_GRAPH_MAX_OPERATIONS = 500
export const PROJECT_GRAPH_CHANGES_PAGE_SIZE = 500
const ENTITY_ID_MAX_LENGTH = 128

export interface ProjectGraphService {
  getGraph: (projectId: string, actor: ProjectActor) => Promise<ProjectGraphResponse>
  getChanges: (projectId: string, after: number, actor: ProjectActor) => Promise<ProjectGraphChangesResponse>
  applyOperations: (
    projectId: string,
    input: ApplyProjectGraphOperationsRequest,
    actor: ProjectActor,
  ) => Promise<ApplyProjectGraphOperationsResponse>
}

function validationError(message: string): never {
  throw new AuthServiceError({
    statusCode: 400,
    apiCode: 'VALIDATION_FAILED',
    message,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength || value.trim() !== value) {
    return validationError(`${field} must be a non-empty string up to ${maxLength} characters`)
  }

  return value
}

function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null) {
    return value as undefined | null
  }

  return requireString(value, field, maxLength)
}

function requireFiniteNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return validationError(`${field} must be a finite number`)
  }

  return value
}

export function validateProjectGraphNode(value: unknown): ProjectGraphNode {
  if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.data)) {
    return validationError('Invalid upsertNode payload')
  }

  const dataSchemaVersion = value.dataSchemaVersion
  if (!Number.isInteger(dataSchemaVersion) || Number(dataSchemaVersion) < 1) {
    return validationError('node.dataSchemaVersion must be a positive integer')
  }

  let size: ProjectGraphNode['size']
  if (value.size !== undefined) {
    if (!isRecord(value.size)) {
      return validationError('node.size must be an object')
    }

    const width = requireFiniteNumber(value.size.width, 'node.size.width')
    const height = requireFiniteNumber(value.size.height, 'node.size.height')
    if (width <= 0 || height <= 0) {
      return validationError('node size must be positive')
    }
    size = { width, height }
  }

  let zIndex: number | undefined
  if (value.zIndex !== undefined) {
    if (!Number.isInteger(value.zIndex) || Number(value.zIndex) < -2_147_483_648 || Number(value.zIndex) > 2_147_483_647) {
      return validationError('node.zIndex must be a 32-bit integer')
    }
    zIndex = Number(value.zIndex)
  }

  if (value.presentation !== undefined && !isRecord(value.presentation)) {
    return validationError('node.presentation must be an object')
  }

  return {
    id: requireString(value.id, 'node.id', ENTITY_ID_MAX_LENGTH),
    nodeType: requireString(value.nodeType, 'node.nodeType', ENTITY_ID_MAX_LENGTH),
    position: {
      x: requireFiniteNumber(value.position.x, 'node.position.x'),
      y: requireFiniteNumber(value.position.y, 'node.position.y'),
    },
    ...(size ? { size } : {}),
    ...(zIndex === undefined ? {} : { zIndex }),
    parentNodeId: optionalString(value.parentNodeId, 'node.parentNodeId', ENTITY_ID_MAX_LENGTH) ?? null,
    dataSchemaVersion: Number(dataSchemaVersion),
    data: value.data,
    presentation: value.presentation as Record<string, unknown> | undefined,
  }
}

export function validateProjectGraphEdge(value: unknown): ProjectGraphEdge {
  if (!isRecord(value)) {
    return validationError('Invalid upsertEdge payload')
  }

  if (value.data !== undefined && !isRecord(value.data)) {
    return validationError('edge.data must be an object')
  }

  return {
    id: requireString(value.id, 'edge.id', ENTITY_ID_MAX_LENGTH),
    source: requireString(value.source, 'edge.source', ENTITY_ID_MAX_LENGTH),
    target: requireString(value.target, 'edge.target', ENTITY_ID_MAX_LENGTH),
    sourceHandle: optionalString(value.sourceHandle, 'edge.sourceHandle', ENTITY_ID_MAX_LENGTH) ?? null,
    targetHandle: optionalString(value.targetHandle, 'edge.targetHandle', ENTITY_ID_MAX_LENGTH) ?? null,
    edgeType: optionalString(value.edgeType, 'edge.edgeType', ENTITY_ID_MAX_LENGTH) ?? null,
    data: value.data as Record<string, unknown> | undefined,
  }
}

function validateOperation(value: unknown): ProjectGraphOperation {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return validationError('Invalid project graph operation')
  }

  if (value.type === 'upsertNode') {
    return { type: 'upsertNode', node: validateProjectGraphNode(value.node) }
  }
  if (value.type === 'deleteNode') {
    return { type: 'deleteNode', nodeId: requireString(value.nodeId, 'nodeId', ENTITY_ID_MAX_LENGTH) }
  }
  if (value.type === 'upsertEdge') {
    return { type: 'upsertEdge', edge: validateProjectGraphEdge(value.edge) }
  }
  if (value.type === 'deleteEdge') {
    return { type: 'deleteEdge', edgeId: requireString(value.edgeId, 'edgeId', ENTITY_ID_MAX_LENGTH) }
  }

  return validationError(`Unsupported project graph operation: ${value.type}`)
}

export function validateApplyProjectGraphOperationsRequest(
  input: ApplyProjectGraphOperationsRequest,
): ApplyProjectGraphOperationsRequest {
  if (!isRecord(input)) {
    return validationError('Project graph request must be an object')
  }

  if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0) {
    return validationError('baseVersion must be a non-negative safe integer')
  }

  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > PROJECT_GRAPH_MAX_OPERATIONS) {
    return validationError(`operations must contain between 1 and ${PROJECT_GRAPH_MAX_OPERATIONS} items`)
  }

  const operations = input.operations.map(validateOperation)
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  for (const operation of operations) {
    const ids = operation.type === 'upsertNode' || operation.type === 'deleteNode' ? nodeIds : edgeIds
    const id = operation.type === 'upsertNode'
      ? operation.node.id
      : operation.type === 'deleteNode'
        ? operation.nodeId
        : operation.type === 'upsertEdge'
          ? operation.edge.id
          : operation.edgeId

    if (ids.has(id)) {
      return validationError(`Entity ${id} is changed more than once in the same batch`)
    }
    ids.add(id)
  }

  return {
    baseVersion: input.baseVersion,
    clientId: requireString(input.clientId, 'clientId', 160),
    batchId: requireString(input.batchId, 'batchId', 160),
    idempotencyKey: requireString(input.idempotencyKey, 'idempotencyKey', 200),
    operations,
  }
}

export function validateProjectGraphChangesAfter(value: unknown) {
  const after = value === undefined || value === null || value === '' ? 0 : Number(value)

  if (!Number.isSafeInteger(after) || after < 0) {
    return validationError('after must be a non-negative safe integer')
  }

  return after
}

export function createUnavailableProjectGraphService(): ProjectGraphService {
  const unavailable = () => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: 'SERVICE_UNAVAILABLE',
      message: 'Project graph service is not configured',
      retryable: true,
    })
  }

  return {
    async getGraph() {
      return unavailable()
    },
    async getChanges() {
      return unavailable()
    },
    async applyOperations() {
      return unavailable()
    },
  }
}
