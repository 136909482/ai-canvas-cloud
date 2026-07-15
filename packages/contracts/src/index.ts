export const API_V1_PREFIX = '/api/v1'

export const apiErrorCodes = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'EMAIL_NOT_VERIFIED',
  'ACCESS_DENIED',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'PROJECT_VERSION_CONFLICT',
  'PROJECT_TOO_LARGE',
  'ASSET_UPLOAD_EXPIRED',
  'ASSET_NOT_READY',
  'ASSET_VALIDATION_FAILED',
  'QUOTA_EXCEEDED',
  'TASK_CONCURRENCY_LIMIT',
  'PROVIDER_CONFIG_INVALID',
  'PROVIDER_UNAVAILABLE',
  'IMPORT_CONFLICT',
  'IMPORT_INVALID',
  'SERVICE_UNAVAILABLE',
] as const

export type ApiErrorCode = typeof apiErrorCodes[number]

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    retryable: boolean
    requestId: string
    details?: Record<string, unknown>
  }
}

export interface HealthDependencyStatus {
  ok: boolean
  latencyMs?: number
  error?: string
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  service: string
  requestId: string
  uptimeSeconds: number
  checkedAt: string
  dependencies?: Record<string, HealthDependencyStatus>
}

export type UserStatus = 'active' | 'disabled' | 'deleted'
export type WorkspaceType = 'personal' | 'team'
export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type WorkspaceStatus = 'active' | 'disabled' | 'deleted'

export interface UserSummary {
  id: string
  email: string
  status: UserStatus
  emailVerified: boolean
}

export interface WorkspaceSummary {
  id: string
  type: WorkspaceType
  name: string
  role: WorkspaceRole
  status: WorkspaceStatus
  planKey: string
}

export interface CurrentWorkspaceResponse {
  workspace: WorkspaceSummary
}

export interface SessionSummary {
  id: string
  deviceLabel: string | null
  lastUsedAt: string
  expiresAt: string
  current: boolean
}

export interface AuthSessionsResponse {
  sessions: SessionSummary[]
}

export interface RevokeSessionResponse {
  ok: true
}

export interface AuthSessionResponse {
  user: UserSummary
  workspace: WorkspaceSummary
}

export interface RegisterRequest {
  email: string
  password: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface AuthSuccessResponse {
  user: UserSummary
  workspace: WorkspaceSummary
  session: {
    expiresAt: string
  }
}

export interface PasswordForgotRequest {
  email: string
}

export interface PasswordResetRequest {
  token: string
  password: string
}

export interface PasswordResetResponse {
  ok: true
}

export interface EmailVerifyRequest {
  token: string
}

export interface EmailVerificationResponse {
  ok: true
}

export interface LogoutResponse {
  ok: true
}

export type ProjectListStatus = 'active' | 'archived'

export interface ProjectSummary {
  id: string
  name: string
  version: number
  lastSequence: number
  nodeCount: number
  edgeCount: number
  taskCount: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectResponse {
  project: ProjectSummary
}

export interface ProjectsResponse {
  projects: ProjectSummary[]
  nextCursor: string | null
}

export interface CreateProjectRequest {
  id?: string
  name: string
}

export interface RenameProjectRequest {
  name: string
}

export interface DeleteProjectResponse {
  ok: true
}

export interface ProjectGraphNode {
  id: string
  nodeType: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
  zIndex?: number
  parentNodeId?: string | null
  dataSchemaVersion: number
  data: Record<string, unknown>
  presentation?: Record<string, unknown>
}

export interface ProjectGraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  edgeType?: string | null
  data?: Record<string, unknown>
}

export type ProjectGraphOperation =
  | { type: 'upsertNode'; node: ProjectGraphNode }
  | { type: 'deleteNode'; nodeId: string }
  | { type: 'upsertEdge'; edge: ProjectGraphEdge }
  | { type: 'deleteEdge'; edgeId: string }

export interface ProjectGraphResponse {
  projectId: string
  version: number
  sequence: number
  nodes: ProjectGraphNode[]
  edges: ProjectGraphEdge[]
}

export interface ApplyProjectGraphOperationsRequest {
  baseVersion: number
  clientId: string
  batchId: string
  idempotencyKey: string
  operations: ProjectGraphOperation[]
}

export interface ApplyProjectGraphOperationsResponse {
  projectId: string
  version: number
  sequence: number
  acceptedBatchId: string
  updatedAt: string
}

export function createServiceUnavailableError(requestId: string, message = 'Service unavailable'): ApiErrorResponse {
  return {
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message,
      retryable: true,
      requestId,
    },
  }
}
