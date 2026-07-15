import assert from 'node:assert/strict'
import test from 'node:test'
import { seedDevelopmentAdminAccount } from '../../dist/modules/auth/devAdminSeed.js'
import { AuthServiceError } from '../../dist/modules/auth/service.js'
import type { AuthService } from '../../dist/modules/auth/service.js'
import type { Logger } from '@ai-canvas-cloud/shared'

function createSilentLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  }
}

function createMockAuthService(register: AuthService['register']): AuthService {
  const unavailable = async () => {
    throw new Error('not implemented')
  }

  return {
    register,
    login: unavailable,
    getSession: unavailable,
    listSessions: unavailable,
    resendVerificationEmail: unavailable,
    verifyEmail: unavailable,
    requestPasswordReset: unavailable,
    resetPassword: unavailable,
    revokeSession: unavailable,
    logout: unavailable,
  }
}

test('development admin seed creates account and verifies email when explicitly enabled', async () => {
  const updatedEmails: string[] = []
  let registeredEmail: string | null = null
  const authService = createMockAuthService(async (input) => {
    registeredEmail = input.email
    return {
      response: {
        user: {
          id: 'user_1',
          email: input.email,
          status: 'active',
          emailVerified: false,
        },
        workspace: {
          id: 'workspace_1',
          type: 'personal',
          name: 'admin 的个人空间',
          role: 'owner',
          status: 'active',
          planKey: 'free',
        },
        session: {
          expiresAt: new Date().toISOString(),
        },
      },
      setCookieHeaders: [],
    }
  })

  await seedDevelopmentAdminAccount({
    enabled: true,
    env: 'development',
    email: ' Admin@Example.COM ',
    password: 'local-admin-password',
    authService,
    pool: {
      async query(_text: string, values?: unknown[]) {
        updatedEmails.push(String(values?.[0]))
        return { rows: [], rowCount: 1 }
      },
    } as never,
    logger: createSilentLogger(),
  })

  assert.equal(registeredEmail, 'admin@example.com')
  assert.deepEqual(updatedEmails, ['admin@example.com'])
})

test('development admin seed skips production and accepts existing local account', async () => {
  let registerCalls = 0
  let updateCalls = 0
  const existingAuthService = createMockAuthService(async () => {
    registerCalls += 1
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'VALIDATION_FAILED',
      message: 'Email is already registered',
    })
  })

  await seedDevelopmentAdminAccount({
    enabled: true,
    env: 'production',
    email: 'admin@example.com',
    password: 'local-admin-password',
    authService: existingAuthService,
    pool: {
      async query() {
        updateCalls += 1
        return { rows: [], rowCount: 1 }
      },
    } as never,
    logger: createSilentLogger(),
  })

  assert.equal(registerCalls, 0)
  assert.equal(updateCalls, 0)

  await seedDevelopmentAdminAccount({
    enabled: true,
    env: 'development',
    email: 'admin@example.com',
    password: 'local-admin-password',
    authService: existingAuthService,
    pool: {
      async query() {
        updateCalls += 1
        return { rows: [], rowCount: 1 }
      },
    } as never,
    logger: createSilentLogger(),
  })

  assert.equal(registerCalls, 1)
  assert.equal(updateCalls, 1)
})
