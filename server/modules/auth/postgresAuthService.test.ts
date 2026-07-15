import assert from 'node:assert/strict'
import test from 'node:test'
import { APIError } from 'better-auth'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import { createPostgresAuthService } from '../../dist/modules/auth/postgresAuthService.js'

interface QueryCall {
  text: string
  values?: unknown[]
}

function createMockPool(handler: (call: QueryCall) => Promise<{ rows: unknown[] }> | { rows: unknown[] }) {
  const calls: QueryCall[] = []

  return {
    calls,
    pool: {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values })
        return handler({ text, values })
      },
    },
  }
}

function createWorkspaceRows() {
  return {
    user_id: 'user-1',
    email: 'artist@example.com',
    email_verified: false,
    user_status: 'active',
    workspace_id: 'workspace-1',
    workspace_type: 'personal',
    workspace_name: 'artist 的个人空间',
    workspace_status: 'active',
    workspace_role: 'owner',
    plan_key: 'free',
  }
}

test('register delegates credentials to Better Auth and creates workspace data', async () => {
  const authApi = {
    async signUpEmail() {
      const headers = new Headers()
      headers.append('set-cookie', 'better-auth.session_token=signed; HttpOnly; Path=/')
      return {
        headers,
        response: {
          token: 'raw-token',
          user: {
            id: 'user-1',
            email: 'artist@example.com',
            emailVerified: false,
            name: 'artist',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      }
    },
  }
  const { pool, calls } = createMockPool(({ text }) => {
    if (text.includes('INSERT INTO workspaces')) {
      return { rows: [{ id: 'workspace-1' }] }
    }

    if (text.includes('SELECT') && text.includes('JOIN workspace_members')) {
      return { rows: [createWorkspaceRows()] }
    }

    return { rows: [] }
  })
  const authService = createPostgresAuthService(pool as never, { authApi: authApi as never })
  const result = await authService.register(
    { email: ' Artist@Example.COM ', password: 'long-enough-password' },
    { requestId: 'req_1', userAgent: 'agent', ipAddress: '127.0.0.1' },
  )

  assert.equal(result.response.user.email, 'artist@example.com')
  assert.equal(result.response.workspace.role, 'owner')
  assert.match(result.setCookieHeaders.join('\n'), /better-auth\.session_token=signed/)
  assert(calls.some((call) => call.text.includes('INSERT INTO workspaces')))
  assert(calls.some((call) => call.text.includes('INSERT INTO workspace_members')))
  assert(calls.some((call) => call.text.includes('INSERT INTO workspace_user_state')))
  assert(calls.some((call) => call.text.includes('DELETE FROM "session"')
    && call.values?.[0] === 'user-1'
    && call.values?.[1] === 'raw-token'))
  assert.equal(calls.some((call) => call.text.includes('INSERT INTO sessions')), false)
})

test('login revokes previous sessions for single-active-device policy', async () => {
  const authApi = {
    async signInEmail() {
      const headers = new Headers()
      headers.append('set-cookie', 'better-auth.session_token=new-signed; HttpOnly; Path=/')
      return {
        headers,
        response: {
          redirect: false,
          token: 'new-token',
          user: {
            id: 'user-1',
            email: 'artist@example.com',
            emailVerified: true,
            name: 'artist',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      }
    },
  }
  const { pool, calls } = createMockPool(({ text }) => {
    if (text.includes('INSERT INTO workspaces')) {
      return { rows: [{ id: 'workspace-1' }] }
    }

    if (text.includes('SELECT') && text.includes('JOIN workspace_members')) {
      return { rows: [createWorkspaceRows()] }
    }

    return { rows: [] }
  })
  const authService = createPostgresAuthService(pool as never, { authApi: authApi as never })
  const result = await authService.login(
    { email: ' Artist@Example.COM ', password: 'long-enough-password' },
    { requestId: 'req_1', userAgent: 'agent', ipAddress: '127.0.0.1' },
  )

  assert.equal(result.response.user.email, 'artist@example.com')
  assert.match(result.setCookieHeaders.join('\n'), /better-auth\.session_token=new-signed/)
  assert(calls.some((call) => call.text.includes('DELETE FROM "session"')
    && call.values?.[0] === 'user-1'
    && call.values?.[1] === 'new-token'))
})

test('register maps Better Auth duplicate email errors to validation conflicts', async () => {
  const authApi = {
    async signUpEmail() {
      throw APIError.from('UNPROCESSABLE_ENTITY', {
        code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
        message: 'User already exists',
      })
    },
  }
  const { pool } = createMockPool(() => ({ rows: [] }))
  const authService = createPostgresAuthService(pool as never, { authApi: authApi as never })

  await assert.rejects(
    () => authService.register(
      { email: 'artist@example.com', password: 'long-enough-password' },
      { requestId: 'req_1' },
    ),
    (error: unknown) => error instanceof AuthServiceError
      && error.statusCode === 409
      && error.apiCode === 'VALIDATION_FAILED',
  )
})

test('resendVerificationEmail asks Better Auth to resend for the current user', async () => {
  let verificationEmail: string | null = null
  const authApi = {
    async getSession() {
      return {
        session: {
          id: 'session-1',
          token: 'session-token',
          userId: 'user-1',
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        user: {
          id: 'user-1',
          email: 'artist@example.com',
          emailVerified: false,
          name: 'artist',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }
    },
    async sendVerificationEmail(input: { body: { email: string } }) {
      verificationEmail = input.body.email
      return { status: true }
    },
  }
  const { pool } = createMockPool(() => ({ rows: [] }))
  const authService = createPostgresAuthService(pool as never, {
    authApi: authApi as never,
  })

  const response = await authService.resendVerificationEmail({
    requestId: 'req_1',
    cookieHeader: 'better-auth.session_token=signed',
  })

  assert.deepEqual(response, { ok: true })
  assert.equal(verificationEmail, 'artist@example.com')
})

test('verifyEmail delegates token consumption to Better Auth', async () => {
  let consumedToken: string | null = null
  const authApi = {
    async verifyEmail(input: { query: { token: string } }) {
      consumedToken = input.query.token
      return { status: true }
    },
  }
  const { pool } = createMockPool(() => ({ rows: [] }))
  const authService = createPostgresAuthService(pool as never, { authApi: authApi as never })

  const response = await authService.verifyEmail({ token: ' token-1 ' }, { requestId: 'req_1' })

  assert.deepEqual(response, { ok: true })
  assert.equal(consumedToken, 'token-1')
})

test('requestPasswordReset delegates normalized email to Better Auth', async () => {
  let requestedEmail: string | null = null
  const authApi = {
    async requestPasswordReset(input: { body: { email: string } }) {
      requestedEmail = input.body.email
      return {
        status: true,
        message: 'If this email exists in our system, check your email for the reset link',
      }
    },
  }
  const { pool } = createMockPool(() => ({ rows: [] }))
  const authService = createPostgresAuthService(pool as never, { authApi: authApi as never })

  const response = await authService.requestPasswordReset(
    { email: ' Artist@Example.COM ' },
    { requestId: 'req_1' },
  )

  assert.deepEqual(response, { ok: true })
  assert.equal(requestedEmail, 'artist@example.com')
})

test('resetPassword validates password and consumes reset token through Better Auth', async () => {
  let resetPayload: { token?: string; newPassword: string } | null = null
  const authApi = {
    async resetPassword(input: { body: { token?: string; newPassword: string } }) {
      resetPayload = input.body
      return { status: true }
    },
  }
  const { pool } = createMockPool(() => ({ rows: [] }))
  const authService = createPostgresAuthService(pool as never, { authApi: authApi as never })

  await assert.rejects(
    () => authService.resetPassword(
      { token: 'token-1', password: 'short' },
      { requestId: 'req_1' },
    ),
    (error: unknown) => error instanceof AuthServiceError
      && error.statusCode === 400
      && error.apiCode === 'VALIDATION_FAILED',
  )

  const response = await authService.resetPassword(
    { token: ' token-1 ', password: 'new-long-enough-password' },
    { requestId: 'req_1' },
  )

  assert.deepEqual(response, { ok: true })
  assert.deepEqual(resetPayload, {
    token: 'token-1',
    newPassword: 'new-long-enough-password',
  })
})
