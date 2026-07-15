import {
  API_V1_PREFIX,
  type ApiErrorCode,
  type ApiErrorResponse,
} from '@ai-canvas-cloud/contracts'

export class CloudApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | null
  readonly details?: Record<string, unknown>

  constructor(options: {
    status: number
    code: ApiErrorCode | null
    message: string
    details?: Record<string, unknown>
  }) {
    super(options.message)
    this.name = 'CloudApiError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

export async function requestCloudJson<TResponse>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_V1_PREFIX}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const payload = await response.json().catch(() => null) as ApiErrorResponse | TResponse | null

  if (!response.ok) {
    const apiError = payload && typeof payload === 'object' && 'error' in payload
      ? payload.error
      : null
    throw new CloudApiError({
      status: response.status,
      code: apiError?.code ?? null,
      message: apiError?.message ?? `HTTP ${response.status}`,
      details: apiError?.details,
    })
  }

  return payload as TResponse
}
