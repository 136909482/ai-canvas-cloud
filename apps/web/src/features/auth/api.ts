import {
  type AuthSessionsResponse,
  type AuthSessionResponse,
  type AuthSuccessResponse,
  type EmailVerificationResponse,
  type EmailVerifyRequest,
  type LoginRequest,
  type LogoutResponse,
  type PasswordForgotRequest,
  type PasswordResetRequest,
  type PasswordResetResponse,
  type RegisterRequest,
  type RevokeSessionResponse,
} from '@ai-canvas-cloud/contracts'
import { requestCloudJson } from '@/api/cloudApiClient'

export function fetchAuthSession() {
  return requestCloudJson<AuthSessionResponse>('/auth/session', {
    method: 'GET',
  })
}

export function registerAuth(input: RegisterRequest) {
  return requestCloudJson<AuthSuccessResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function loginAuth(input: LoginRequest) {
  return requestCloudJson<AuthSuccessResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function logoutAuth() {
  return requestCloudJson<LogoutResponse>('/auth/logout', {
    method: 'POST',
  })
}

export function fetchAuthSessions() {
  return requestCloudJson<AuthSessionsResponse>('/auth/sessions', {
    method: 'GET',
  })
}

export function revokeAuthSession(sessionId: string) {
  return requestCloudJson<RevokeSessionResponse>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  })
}

export function resendAuthVerificationEmail() {
  return requestCloudJson<EmailVerificationResponse>('/auth/email/resend', {
    method: 'POST',
  })
}

export function verifyAuthEmail(input: EmailVerifyRequest) {
  return requestCloudJson<EmailVerificationResponse>('/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function requestAuthPasswordReset(input: PasswordForgotRequest) {
  return requestCloudJson<PasswordResetResponse>('/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function resetAuthPassword(input: PasswordResetRequest) {
  return requestCloudJson<PasswordResetResponse>('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
