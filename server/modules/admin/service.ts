import type {
  AdminAuditEventInput,
  AdminAuditPage,
  AdminAuthResult,
  AdminLoginResponse,
  AdminPermission,
  AdminRequestContext,
  AdminSession,
} from './types.js'

export interface AdminAuditQuery {
  cursor?: string
  limit?: number
  action?: string
  result?: 'success' | 'failure'
}

export interface AdminService {
  login(input: { username: string; password: string; captchaChallengeId?: string; captchaCode?: string }, context: AdminRequestContext): Promise<AdminAuthResult<AdminLoginResponse>>
  createLoginCaptcha(): Promise<{ enabled: boolean; challenge: { id: string; imageDataUrl: string; expiresAt: string } | null }>
  getLoginSecuritySettings(context: AdminRequestContext): Promise<{ captchaEnabled: boolean; updatedAt: string }>
  updateLoginSecuritySettings(input: { captchaEnabled: boolean }, context: AdminRequestContext): Promise<{ captchaEnabled: boolean; updatedAt: string }>
  getSession(context: AdminRequestContext): Promise<AdminSession>
  updateUsername(input: { username: string }, context: AdminRequestContext): Promise<AdminSession>
  changePassword(input: { currentPassword: string; newPassword: string }, context: AdminRequestContext): Promise<AdminAuthResult<AdminSession>>
  logout(context: AdminRequestContext): Promise<AdminAuthResult<{ success: true }>>
  requirePermission(context: AdminRequestContext, permission: AdminPermission): Promise<AdminSession>
  listAuditEvents(query: AdminAuditQuery, context: AdminRequestContext): Promise<AdminAuditPage>
  appendAuditEvent(input: AdminAuditEventInput): Promise<void>
}

export function createUnavailableAdminService(): AdminService {
  const unavailable = async (): Promise<never> => {
    throw new Error('Admin service is unavailable')
  }
  return {
    login: unavailable,
    createLoginCaptcha: unavailable,
    getLoginSecuritySettings: unavailable,
    updateLoginSecuritySettings: unavailable,
    getSession: unavailable,
    updateUsername: unavailable,
    changePassword: unavailable,
    logout: unavailable,
    requirePermission: unavailable,
    listAuditEvents: unavailable,
    appendAuditEvent: unavailable,
  }
}
