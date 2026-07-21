import type {
  AdminAuditEventInput,
  AdminAuditPage,
  AdminAuthResult,
  AdminLoginResponse,
  AdminMfaSetupResponse,
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
  login(input: { email: string; password: string }, context: AdminRequestContext): Promise<AdminAuthResult<AdminLoginResponse>>
  getSession(context: AdminRequestContext): Promise<AdminSession>
  setupTotp(input: { password: string }, context: AdminRequestContext): Promise<AdminAuthResult<AdminMfaSetupResponse>>
  verifyTotp(input: { code: string }, context: AdminRequestContext): Promise<AdminAuthResult<AdminSession>>
  verifyRecoveryCode(input: { code: string }, context: AdminRequestContext): Promise<AdminAuthResult<AdminSession>>
  regenerateRecoveryCodes(input: { password: string }, context: AdminRequestContext): Promise<AdminAuthResult<{ recoveryCodes: string[] }>>
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
    getSession: unavailable,
    setupTotp: unavailable,
    verifyTotp: unavailable,
    verifyRecoveryCode: unavailable,
    regenerateRecoveryCodes: unavailable,
    logout: unavailable,
    requirePermission: unavailable,
    listAuditEvents: unavailable,
    appendAuditEvent: unavailable,
  }
}
