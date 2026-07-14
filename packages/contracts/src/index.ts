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
