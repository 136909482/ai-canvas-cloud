import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {
  API_V1_PREFIX,
  type ApplyProjectGraphOperationsResponse,
  type AuthSessionResponse,
  type AuthSessionsResponse,
  type AuthSuccessResponse,
  type CurrentWorkspaceResponse,
  type ProjectGraphResponse,
  type ProjectResponse,
  type ProjectsResponse,
  type RevokeSessionResponse,
} from '@ai-canvas-cloud/contracts'
import {
  BETTER_AUTH_SESSION_COOKIE_NAME,
  AuthServiceError,
  type AuthService,
  type IssuedAuthSession,
} from '@ai-canvas-cloud/server/modules/auth'
import type { ProjectGraphService } from '@ai-canvas-cloud/server/modules/project-graph'
import type { ProjectActor, ProjectService } from '@ai-canvas-cloud/server/modules/projects'
import { closeApiServer, createApiServer } from '../dist/server.js'
import type { ApiConfig } from './config.ts'

const config: ApiConfig = {
  env: 'test',
  logLevel: 'error',
  host: '127.0.0.1',
  port: 0,
  shutdownTimeoutMs: 1_000,
  betterAuthUrl: 'http://127.0.0.1:8787',
  betterAuthSecret: 'test-better-auth-secret-that-is-long-enough',
  webPublicUrl: 'http://localhost:5173',
  databaseUrl: 'postgres://localhost:5432/ai_canvas_cloud',
  redisUrl: 'redis://localhost:6379',
  s3Endpoint: 'http://localhost:9000',
  s3Bucket: 'ai-canvas-cloud',
  s3Region: 'local',
  s3AccessKeyId: 'test',
  s3SecretAccessKey: 'test',
}

function createAuthResponse(expiresAt: Date): AuthSuccessResponse {
  return {
    user: {
      id: 'user_1',
      email: 'artist@example.com',
      status: 'active',
      emailVerified: true,
    },
    workspace: {
      id: 'workspace_1',
      type: 'personal',
      name: 'artist 的个人空间',
      role: 'owner',
      status: 'active',
      planKey: 'free',
    },
    session: {
      expiresAt: expiresAt.toISOString(),
    },
  }
}

function createFakeAuthService(): AuthService {
  const expiresAt = new Date(Date.now() + 60_000)
  const issued: IssuedAuthSession = {
    response: createAuthResponse(expiresAt),
    setCookieHeaders: [`${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session; HttpOnly; Path=/; SameSite=Lax`],
  }

  return {
    async register() {
      return issued
    },
    async login() {
      return issued
    },
    async getSession(context): Promise<AuthSessionResponse> {
      if (!context.cookieHeader?.includes(`${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`)) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: 'SESSION_EXPIRED',
          message: 'Session expired',
        })
      }

      return {
        user: issued.response.user,
        workspace: issued.response.workspace,
      }
    },
    async listSessions() {
      return {
        sessions: [
          {
            id: 'session_current',
            deviceLabel: 'Test Browser',
            lastUsedAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString(),
            current: true,
          },
          {
            id: 'session_other',
            deviceLabel: 'Other Browser',
            lastUsedAt: new Date(Date.now() - 1_000).toISOString(),
            expiresAt: expiresAt.toISOString(),
            current: false,
          },
        ],
      }
    },
    async resendVerificationEmail() {
      return { ok: true }
    },
    async verifyEmail() {
      return { ok: true }
    },
    async requestPasswordReset() {
      return { ok: true }
    },
    async resetPassword() {
      return { ok: true }
    },
    async revokeSession(sessionId: string) {
      if (sessionId !== 'session_other') {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: 'RESOURCE_NOT_FOUND',
          message: 'Session not found',
        })
      }

      return {
        response: { ok: true },
        setCookieHeaders: [],
      }
    },
    async logout() {
      return {
        setCookieHeaders: [`${BETTER_AUTH_SESSION_COOKIE_NAME}=; Max-Age=0; Path=/`],
      }
    },
  }
}

function createProjectResponse(overrides: Partial<ProjectResponse['project']> = {}): ProjectResponse {
  return {
    project: {
      id: '11111111-1111-4111-8111-111111111111',
      name: '产品主视觉',
      version: 0,
      lastSequence: 0,
      nodeCount: 0,
      edgeCount: 0,
      taskCount: 0,
      archivedAt: null,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      ...overrides,
    },
  }
}

function createFakeProjectService() {
  const actors: ProjectActor[] = []
  let response = createProjectResponse()

  const capture = (actor: ProjectActor) => {
    actors.push(actor)
  }

  const service: ProjectService = {
    async listProjects(_input, actor): Promise<ProjectsResponse> {
      capture(actor)
      return { projects: [response.project], nextCursor: null }
    },
    async createProject(input, actor) {
      capture(actor)
      response = createProjectResponse({ id: input.id, name: input.name })
      return response
    },
    async getProject(_projectId, actor) {
      capture(actor)
      return response
    },
    async renameProject(_projectId, input, actor) {
      capture(actor)
      response = createProjectResponse({ name: input.name })
      return response
    },
    async archiveProject(_projectId, actor) {
      capture(actor)
      response = createProjectResponse({ archivedAt: '2026-07-15T01:00:00.000Z' })
      return response
    },
    async restoreProject(_projectId, actor) {
      capture(actor)
      response = createProjectResponse({ archivedAt: null })
      return response
    },
    async deleteProject(_projectId, actor) {
      capture(actor)
      return { ok: true }
    },
  }

  return { actors, service }
}

function createFakeProjectGraphService() {
  const actors: ProjectActor[] = []
  const graph: ProjectGraphResponse = {
    projectId: '11111111-1111-4111-8111-111111111111',
    version: 0,
    sequence: 0,
    nodes: [],
    edges: [],
  }
  const service: ProjectGraphService = {
    async getGraph(_projectId, actor) {
      actors.push(actor)
      return graph
    },
    async applyOperations(_projectId, input, actor): Promise<ApplyProjectGraphOperationsResponse> {
      actors.push(actor)
      if (input.baseVersion !== 0) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: 'PROJECT_VERSION_CONFLICT',
          message: 'Project was updated by another client',
          details: { currentVersion: 1 },
        })
      }

      return {
        projectId: graph.projectId,
        version: 1,
        sequence: 1,
        acceptedBatchId: input.batchId,
        updatedAt: '2026-07-15T01:00:00.000Z',
      }
    },
  }

  return { actors, service }
}

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assert(address && typeof address === 'object')
      resolve(address.port)
    })
  })
}

function requestJson(port: number, options: {
  method: string
  path: string
  body?: unknown
  cookie?: string
}) {
  return new Promise<{
    statusCode: number
    headers: http.IncomingHttpHeaders
    body: unknown
  }>((resolve, reject) => {
    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body)
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: options.path,
      method: options.method,
      headers: {
        ...(bodyText ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyText) } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: text ? JSON.parse(text) as unknown : null,
        })
      })
    })

    request.on('error', reject)

    if (bodyText) {
      request.write(bodyText)
    }

    request.end()
  })
}

test('register route issues a HttpOnly session cookie and auth response', async () => {
  const server = createApiServer({ config, authService: createFakeAuthService() })
  const port = await listen(server)

  try {
    const response = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/auth/register`,
      body: { email: 'artist@example.com', password: 'long-enough-password' },
    })

    assert.equal(response.statusCode, 201)
    assert.match(String(response.headers['set-cookie']), new RegExp(`${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`))
    assert.match(String(response.headers['set-cookie']), /HttpOnly/)
    assert.deepEqual((response.body as AuthSuccessResponse).workspace.role, 'owner')
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('password reset routes request and consume reset tokens', async () => {
  const server = createApiServer({ config, authService: createFakeAuthService() })
  const port = await listen(server)

  try {
    const forgot = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/auth/password/forgot`,
      body: { email: 'artist@example.com' },
    })

    assert.equal(forgot.statusCode, 200)
    assert.deepEqual(forgot.body, { ok: true })

    const reset = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/auth/password/reset`,
      body: { token: 'reset-token', password: 'new-long-enough-password' },
    })

    assert.equal(reset.statusCode, 200)
    assert.deepEqual(reset.body, { ok: true })
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('email verification routes resend and consume verification tokens', async () => {
  const server = createApiServer({ config, authService: createFakeAuthService() })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`

  try {
    const resendMissingCookie = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/auth/email/resend`,
    })

    assert.equal(resendMissingCookie.statusCode, 401)
    assert.equal((resendMissingCookie.body as { error: { code: string } }).error.code, 'AUTH_REQUIRED')

    const resent = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/auth/email/resend`,
      cookie,
    })

    assert.equal(resent.statusCode, 200)
    assert.deepEqual(resent.body, { ok: true })

    const verified = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/auth/email/verify`,
      body: { token: 'verification-token' },
    })

    assert.equal(verified.statusCode, 200)
    assert.deepEqual(verified.body, { ok: true })
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('session route requires a session cookie and resolves the current workspace', async () => {
  const server = createApiServer({ config, authService: createFakeAuthService() })
  const port = await listen(server)

  try {
    const missingCookie = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/auth/session`,
    })

    assert.equal(missingCookie.statusCode, 401)
    assert.equal((missingCookie.body as { error: { code: string } }).error.code, 'AUTH_REQUIRED')

    const session = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/auth/session`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    })

    assert.equal(session.statusCode, 200)
    assert.equal((session.body as AuthSessionResponse).workspace.id, 'workspace_1')
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('current workspace route requires auth and returns session workspace', async () => {
  const server = createApiServer({ config, authService: createFakeAuthService() })
  const port = await listen(server)

  try {
    const missingCookie = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/workspaces/current`,
    })

    assert.equal(missingCookie.statusCode, 401)
    assert.equal((missingCookie.body as { error: { code: string } }).error.code, 'AUTH_REQUIRED')

    const current = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/workspaces/current`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    })

    assert.equal(current.statusCode, 200)
    assert.equal((current.body as CurrentWorkspaceResponse).workspace.id, 'workspace_1')
    assert.equal((current.body as CurrentWorkspaceResponse).workspace.role, 'owner')
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('session management routes list and revoke active sessions', async () => {
  const server = createApiServer({ config, authService: createFakeAuthService() })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`

  try {
    const list = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/auth/sessions`,
      cookie,
    })

    assert.equal(list.statusCode, 200)
    const sessions = list.body as AuthSessionsResponse
    assert.equal(sessions.sessions.length, 2)
    assert.equal(sessions.sessions[0]?.current, true)

    const revoked = await requestJson(port, {
      method: 'DELETE',
      path: `${API_V1_PREFIX}/auth/sessions/session_other`,
      cookie,
    })

    assert.equal(revoked.statusCode, 200)
    assert.deepEqual(revoked.body as RevokeSessionResponse, { ok: true })

    const missing = await requestJson(port, {
      method: 'DELETE',
      path: `${API_V1_PREFIX}/auth/sessions/missing`,
      cookie,
    })

    assert.equal(missing.statusCode, 404)
    assert.equal((missing.body as { error: { code: string } }).error.code, 'RESOURCE_NOT_FOUND')
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('project metadata routes use the session actor for the complete lifecycle', async () => {
  const projects = createFakeProjectService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    projectService: projects.service,
  })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`
  const projectPath = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111`

  try {
    const missingSession = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/projects`,
    })
    assert.equal(missingSession.statusCode, 401)

    const created = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/projects`,
      cookie,
      body: {
        id: '22222222-2222-4222-8222-222222222222',
        name: '新项目',
        userId: 'forged-user',
        workspaceId: 'forged-workspace',
      },
    })
    assert.equal(created.statusCode, 201)
    assert.equal((created.body as ProjectResponse).project.id, '22222222-2222-4222-8222-222222222222')
    assert.equal((created.body as ProjectResponse).project.name, '新项目')

    const listed = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/projects?status=active&limit=20`,
      cookie,
    })
    assert.equal(listed.statusCode, 200)
    assert.equal((listed.body as ProjectsResponse).projects.length, 1)

    assert.equal((await requestJson(port, { method: 'GET', path: projectPath, cookie })).statusCode, 200)
    assert.equal((await requestJson(port, {
      method: 'PATCH',
      path: projectPath,
      cookie,
      body: { name: '重命名' },
    })).statusCode, 200)
    assert.equal((await requestJson(port, { method: 'POST', path: `${projectPath}/archive`, cookie })).statusCode, 200)
    assert.equal((await requestJson(port, { method: 'POST', path: `${projectPath}/restore`, cookie })).statusCode, 200)
    assert.equal((await requestJson(port, { method: 'DELETE', path: projectPath, cookie })).statusCode, 200)

    assert.equal(projects.actors.length, 7)
    assert(projects.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('project routes preserve non-disclosing two-account isolation', async () => {
  const baseAuthService = createFakeAuthService()
  const authService: AuthService = {
    ...baseAuthService,
    async getSession(context) {
      if (context.cookieHeader?.includes('session_b')) {
        return {
          user: { id: 'user_b', email: 'b@example.com', status: 'active', emailVerified: true },
          workspace: {
            id: 'workspace_b',
            type: 'personal',
            name: 'B workspace',
            role: 'owner',
            status: 'active',
            planKey: 'free',
          },
        }
      }

      if (context.cookieHeader?.includes('session_a')) {
        return {
          user: { id: 'user_a', email: 'a@example.com', status: 'active', emailVerified: true },
          workspace: {
            id: 'workspace_a',
            type: 'personal',
            name: 'A workspace',
            role: 'owner',
            status: 'active',
            planKey: 'free',
          },
        }
      }

      throw new AuthServiceError({
        statusCode: 401,
        apiCode: 'SESSION_EXPIRED',
        message: 'Session expired',
      })
    },
  }
  const projectService: ProjectService = {
    ...createFakeProjectService().service,
    async getProject(_projectId, actor) {
      if (actor.workspaceId !== 'workspace_b') {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: 'RESOURCE_NOT_FOUND',
          message: 'Project not found',
        })
      }

      return createProjectResponse()
    },
  }
  const server = createApiServer({ config, authService, projectService })
  const port = await listen(server)
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111`

  try {
    const forbiddenCrossAccountRead = await requestJson(port, {
      method: 'GET',
      path,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=session_a`,
    })
    assert.equal(forbiddenCrossAccountRead.statusCode, 404)
    assert.equal(
      (forbiddenCrossAccountRead.body as { error: { code: string } }).error.code,
      'RESOURCE_NOT_FOUND',
    )

    const ownerRead = await requestJson(port, {
      method: 'GET',
      path,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=session_b`,
    })
    assert.equal(ownerRead.statusCode, 200)
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('project graph routes use the session actor and preserve conflict details', async () => {
  const graphs = createFakeProjectGraphService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    projectGraphService: graphs.service,
  })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/graph`
  const operationBody = {
    baseVersion: 0,
    clientId: 'browser_1',
    batchId: 'batch_1',
    idempotencyKey: 'graph_1',
    userId: 'forged-user',
    workspaceId: 'forged-workspace',
    operations: [{ type: 'deleteNode', nodeId: 'node_1' }],
  }

  try {
    const graph = await requestJson(port, { method: 'GET', path, cookie })
    assert.equal(graph.statusCode, 200)
    assert.equal((graph.body as ProjectGraphResponse).version, 0)

    const applied = await requestJson(port, {
      method: 'PATCH',
      path,
      cookie,
      body: operationBody,
    })
    assert.equal(applied.statusCode, 200)
    assert.equal((applied.body as ApplyProjectGraphOperationsResponse).acceptedBatchId, 'batch_1')
    assert(graphs.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))

    const conflict = await requestJson(port, {
      method: 'PATCH',
      path,
      cookie,
      body: { ...operationBody, baseVersion: 1, batchId: 'batch_2', idempotencyKey: 'graph_2' },
    })
    assert.equal(conflict.statusCode, 409)
    assert.equal((conflict.body as { error: { code: string } }).error.code, 'PROJECT_VERSION_CONFLICT')
    assert.equal((conflict.body as { error: { details: { currentVersion: number } } }).error.details.currentVersion, 1)
  } finally {
    await closeApiServer(server, 1_000)
  }
})
