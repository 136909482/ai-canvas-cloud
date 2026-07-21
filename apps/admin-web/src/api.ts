import type {
  AdminAuditEventsResponse,
  AdminCsrfResponse,
  AdminLoginResponse,
  AdminMfaSetupResponse,
  AdminRecoveryCodesResponse,
  AdminSessionResponse,
} from '@ai-canvas-cloud/contracts'

const API_URL = (import.meta.env.VITE_ADMIN_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8788'
let csrfToken: string | null = null

export class AdminApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
    this.code = code
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error
      : undefined
    throw new AdminApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'SERVICE_UNAVAILABLE',
      typeof error?.message === 'string' ? error.message : '管理服务暂时不可用',
    )
  }
  return payload as T
}

async function refreshCsrf() {
  const response = await fetch(`${API_URL}/admin/v1/auth/csrf`, {
    method: 'GET',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  const payload = await parseResponse<AdminCsrfResponse>(response)
  csrfToken = payload.token
  return payload.token
}

async function request<T>(path: string, init: RequestInit = {}, retryCsrf = true): Promise<T> {
  const method = init.method ?? 'GET'
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
  const token = isWrite ? (csrfToken ?? await refreshCsrf()) : null
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-csrf-token': token } : {}),
      ...init.headers,
    },
  })
  if (isWrite && response.status === 403 && retryCsrf) {
    csrfToken = null
    await refreshCsrf()
    return request<T>(path, init, false)
  }
  return parseResponse<T>(response)
}

function post<T>(path: string, body: Record<string, unknown> = {}) {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export const adminApi = {
  login(email: string, password: string) {
    return post<AdminLoginResponse>('/admin/v1/auth/login', { email, password })
  },
  session() {
    return request<AdminSessionResponse>('/admin/v1/auth/session')
  },
  setupTotp(password: string) {
    return post<AdminMfaSetupResponse>('/admin/v1/auth/mfa/setup', { password })
  },
  verifyTotp(code: string) {
    return post<AdminSessionResponse>('/admin/v1/auth/mfa/verify-totp', { code })
  },
  verifyRecoveryCode(code: string) {
    return post<AdminSessionResponse>('/admin/v1/auth/mfa/verify-recovery', { code })
  },
  regenerateRecoveryCodes(password: string) {
    return post<AdminRecoveryCodesResponse>('/admin/v1/auth/mfa/recovery-codes', { password })
  },
  async logout() {
    await post<{ success: true }>('/admin/v1/auth/logout')
    csrfToken = null
  },
  auditEvents(params: { cursor?: string; limit?: number; action?: string; result?: string } = {}) {
    const query = new URLSearchParams()
    if (params.cursor) query.set('cursor', params.cursor)
    if (params.limit) query.set('limit', String(params.limit))
    if (params.action) query.set('action', params.action)
    if (params.result) query.set('result', params.result)
    return request<AdminAuditEventsResponse>(`/admin/v1/audit-events${query.size ? `?${query}` : ''}`)
  },
}
