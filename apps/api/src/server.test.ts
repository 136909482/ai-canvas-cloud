import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {
  API_V1_PREFIX,
  type AssetResponse,
  type AssetUploadResponse,
  type AssetUrlResponse,
  type ApplyProjectGraphOperationsResponse,
  type AuthDevicesResponse,
  type AuthSessionResponse,
  type AuthSessionsResponse,
  type CompleteAssetUploadResponse,
  type AuthSuccessResponse,
  type CurrentWorkspaceResponse,
  type WorkspaceUsageResponse,
  type ProjectCheckpointResponse,
  type ProjectGraphChangesResponse,
  type ProjectGraphResponse,
  type ProjectRevisionRestoreResponse,
  type ProjectRevisionResponse,
  type ProjectRevisionsResponse,
  type ProjectResponse,
  type ProjectsResponse,
  type RevokeSessionResponse,
  type ProviderSettingsResponse,
  type GenerationTaskResponse,
  type GenerationTasksResponse,
} from '@ai-canvas-cloud/contracts'
import type { AssetService } from '@ai-canvas-cloud/server/modules/assets'
import {
  BETTER_AUTH_SESSION_COOKIE_NAME,
  AuthServiceError,
  type AuthService,
  type IssuedAuthSession,
} from '@ai-canvas-cloud/server/modules/auth'
import type { ProjectGraphService } from '@ai-canvas-cloud/server/modules/project-graph'
import type { ProjectSnapshotService } from '@ai-canvas-cloud/server/modules/project-snapshots'
import type { ProjectActor, ProjectService } from '@ai-canvas-cloud/server/modules/projects'
import type { ProviderCredentialService } from '@ai-canvas-cloud/server/modules/providers'
import type { GenerationTaskService } from '@ai-canvas-cloud/server/modules/tasks'
import type { WorkspaceUsageService } from '@ai-canvas-cloud/server/modules/workspaces'
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
  providerCredentialKeys: `1:${Buffer.alloc(32, 1).toString('base64')}`,
  providerCredentialActiveKeyVersion: 1,
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
            createdAt: new Date(Date.now() - 5_000).toISOString(),
            lastUsedAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString(),
            current: true,
          },
          {
            id: 'session_other',
            deviceLabel: 'Other Browser',
            createdAt: new Date(Date.now() - 10_000).toISOString(),
            lastUsedAt: new Date(Date.now() - 1_000).toISOString(),
            expiresAt: expiresAt.toISOString(),
            current: false,
          },
        ],
      }
    },
    async listDevices() {
      return {
        devices: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            deviceLabel: 'Test Browser',
            firstSeenAt: new Date(Date.now() - 5_000).toISOString(),
            lastSeenAt: new Date().toISOString(),
            current: true,
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            deviceLabel: 'Other Browser',
            firstSeenAt: new Date(Date.now() - 10_000).toISOString(),
            lastSeenAt: new Date(Date.now() - 1_000).toISOString(),
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
    async removeDevice(deviceId: string) {
      if (deviceId !== '22222222-2222-4222-8222-222222222222') {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: 'RESOURCE_NOT_FOUND',
          message: 'Device not found',
        })
      }

      return { ok: true }
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
    async getChanges(_projectId, after, actor): Promise<ProjectGraphChangesResponse> {
      actors.push(actor)
      return {
        projectId: graph.projectId,
        version: graph.version,
        sequence: graph.sequence,
        after,
        changes: [],
        hasMore: false,
      }
    },
    async applyOperations(_projectId, input, actor): Promise<ApplyProjectGraphOperationsResponse> {
      actors.push(actor)
      const referencesPendingAsset = input.operations.some((operation) =>
        operation.type === 'upsertNode'
        && (operation.node.data.imageAsset as { assetId?: unknown } | undefined)?.assetId
          === '44444444-4444-4444-8444-444444444444',
      )
      if (referencesPendingAsset) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: 'ASSET_NOT_READY',
          message: 'Referenced asset is not ready',
        })
      }
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

function createFakeProjectSnapshotService() {
  const actors: ProjectActor[] = []
  const service: ProjectSnapshotService = {
    async listRevisions(_projectId, input, actor): Promise<ProjectRevisionsResponse> {
      actors.push(actor)
      return {
        revisions: [{
          id: '33333333-3333-4333-8333-333333333333',
          projectId: '11111111-1111-4111-8111-111111111111',
          projectVersion: 1,
          lastSequence: 1,
          snapshotType: 'manual',
          schemaVersion: 1,
          byteSize: 128,
          isValid: true,
          createdAt: '2026-07-15T02:00:00.000Z',
        }],
        nextCursor: input.limit === 1 ? 'cursor_1' : null,
      }
    },
    async getRevision(_projectId, version, actor): Promise<ProjectRevisionResponse> {
      actors.push(actor)
      if (version !== 1) {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: 'RESOURCE_NOT_FOUND',
          message: 'Project revision not found',
        })
      }

      return {
        checkpoint: {
          id: '33333333-3333-4333-8333-333333333333',
          projectId: '11111111-1111-4111-8111-111111111111',
          projectVersion: 1,
          lastSequence: 1,
          snapshotType: 'manual',
          schemaVersion: 1,
          byteSize: 128,
          isValid: true,
          createdAt: '2026-07-15T02:00:00.000Z',
        },
        record: {
          schemaVersion: 1,
          project: {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Project',
            version: 1,
            lastSequence: 1,
          },
          canvas: { nodes: [], edges: [] },
          taskQueue: { tasks: [] },
        },
      }
    },
    async createCheckpoint(_projectId, input, actor): Promise<ProjectCheckpointResponse> {
      actors.push(actor)
      if (input.expectedVersion !== 1 || input.expectedSequence !== 1) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: 'PROJECT_VERSION_CONFLICT',
          message: 'Project was updated before checkpoint creation',
          details: { currentVersion: 1, currentSequence: 1 },
        })
      }

      return {
        checkpoint: {
          id: '33333333-3333-4333-8333-333333333333',
          projectId: '11111111-1111-4111-8111-111111111111',
          projectVersion: 1,
          lastSequence: 1,
          snapshotType: input.checkpointType ?? 'manual',
          schemaVersion: 1,
          byteSize: 128,
          isValid: true,
          createdAt: '2026-07-15T02:00:00.000Z',
        },
        project: createProjectResponse({ version: 1, lastSequence: 1 }).project,
      }
    },
    async restoreRevision(_projectId, version, input, actor): Promise<ProjectRevisionRestoreResponse> {
      actors.push(actor)
      if (version === 3) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: 'ASSET_NOT_READY',
          message: 'Referenced asset is not ready',
        })
      }
      if (version !== 1) {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: 'RESOURCE_NOT_FOUND',
          message: 'Project revision not found',
        })
      }
      if (input.expectedVersion !== 2 || input.expectedSequence !== 2) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: 'PROJECT_VERSION_CONFLICT',
          message: 'Project was updated before revision restore',
          details: { currentVersion: 2, currentSequence: 2 },
        })
      }

      return {
        restoredCheckpoint: {
          id: '33333333-3333-4333-8333-333333333333',
          projectId: '11111111-1111-4111-8111-111111111111',
          projectVersion: 1,
          lastSequence: 1,
          snapshotType: 'manual',
          schemaVersion: 1,
          byteSize: 128,
          isValid: true,
          createdAt: '2026-07-15T02:00:00.000Z',
        },
        preRestoreCheckpoint: {
          id: '44444444-4444-4444-8444-444444444444',
          projectId: '11111111-1111-4111-8111-111111111111',
          projectVersion: 2,
          lastSequence: 2,
          snapshotType: 'pre_restore',
          schemaVersion: 1,
          byteSize: 256,
          isValid: true,
          createdAt: '2026-07-15T03:00:00.000Z',
        },
        project: createProjectResponse({ version: 3, lastSequence: 3 }).project,
        version: 3,
        sequence: 3,
      }
    },
  }

  return { actors, service }
}

function createFakeAssetService() {
  const actors: ProjectActor[] = []
  const service: AssetService = {
    async createUpload(input, actor): Promise<AssetUploadResponse> {
      actors.push(actor)
      return {
        upload: {
          id: '55555555-5555-4555-8555-555555555555',
          assetId: '66666666-6666-4666-8666-666666666666',
          projectId: input.projectId ?? null,
          originalFileName: input.originalFileName,
          expectedMimeType: input.mimeType,
          expectedByteSize: input.byteSize,
          expectedSha256: input.sha256 ?? null,
          assetKind: input.assetKind,
          status: 'pending',
          expiresAt: '2026-07-15T00:15:00.000Z',
          createdAt: '2026-07-15T00:00:00.000Z',
        },
        asset: {
          id: '66666666-6666-4666-8666-666666666666',
          projectId: input.projectId ?? null,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          sha256: input.sha256 ?? null,
          width: input.width ?? null,
          height: input.height ?? null,
          assetKind: input.assetKind,
          status: 'pending',
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:00:00.000Z',
        },
        directUpload: {
          method: 'PUT',
          url: 'http://localhost:9000/ai-canvas-cloud/presigned-upload',
          headers: { 'content-type': input.mimeType },
          expiresAt: '2026-07-15T00:15:00.000Z',
        },
      }
    },
    async completeUpload(uploadId, actor): Promise<CompleteAssetUploadResponse> {
      actors.push(actor)
      return {
        upload: {
          id: uploadId,
          assetId: '66666666-6666-4666-8666-666666666666',
          projectId: '11111111-1111-4111-8111-111111111111',
          originalFileName: 'reference.png',
          expectedMimeType: 'image/png',
          expectedByteSize: 2048,
          expectedSha256: null,
          assetKind: 'upload',
          status: 'completed',
          expiresAt: '2026-07-15T00:15:00.000Z',
          createdAt: '2026-07-15T00:00:00.000Z',
        },
        asset: {
          id: '66666666-6666-4666-8666-666666666666',
          projectId: '11111111-1111-4111-8111-111111111111',
          originalFileName: 'reference.png',
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: null,
          width: null,
          height: null,
          assetKind: 'upload',
          status: 'completed',
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:10:00.000Z',
        },
      }
    },
    async getAsset(assetId, actor): Promise<AssetResponse> {
      actors.push(actor)
      return {
        asset: {
          id: assetId,
          projectId: '11111111-1111-4111-8111-111111111111',
          originalFileName: 'reference.png',
          mimeType: 'image/png',
          byteSize: 2048,
          sha256: null,
          width: null,
          height: null,
          assetKind: 'upload',
          status: 'completed',
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:10:00.000Z',
        },
      }
    },
    async getAssetUrl(assetId, actor): Promise<AssetUrlResponse> {
      actors.push(actor)
      return {
        assetId,
        url: 'http://localhost:9000/ai-canvas-cloud/presigned-read',
        expiresAt: '2026-07-15T00:15:00.000Z',
      }
    },
  }

  return { actors, service }
}

function createFakeWorkspaceUsageService() {
  const actors: ProjectActor[] = []
  const service: WorkspaceUsageService = {
    async getCurrentUsage(actor): Promise<WorkspaceUsageResponse> {
      actors.push(actor)
      return {
        workspaceId: actor.workspaceId,
        storage: {
          usedBytes: 1024,
          reservedBytes: 512,
          totalBytes: 1536,
          quotaBytes: 20 * 1024 * 1024 * 1024,
          availableBytes: 20 * 1024 * 1024 * 1024 - 1536,
        },
      }
    },
  }
  return { actors, service }
}

function createFakeProviderCredentialService() {
  const actors: ProjectActor[] = []
  const calls: string[] = []
  const service: ProviderCredentialService = {
    async listProviders(actor) {
      actors.push(actor)
      calls.push('list')
      return {
        providers: [{
          providerId: 'openai',
          label: 'OpenAI',
          baseUrl: 'https://api.openai.com',
          configured: false,
          status: 'not_configured',
          secretLastFour: null,
          updatedAt: null,
        }],
      }
    },
    async putProvider(providerId, input, actor) {
      actors.push(actor)
      calls.push(`put:${providerId}`)
      return {
        provider: {
          providerId: 'openai',
          label: 'OpenAI',
          baseUrl: 'https://api.openai.com',
          configured: true,
          status: 'active',
          secretLastFour: input.apiKey.slice(-4),
          updatedAt: '2026-07-16T00:00:00.000Z',
        },
      }
    },
    async deleteProvider(providerId, actor) {
      actors.push(actor)
      calls.push(`delete:${providerId}`)
      return { ok: true }
    },
    async getExecutionCredential() {
      throw new Error('Execution credential is not expected in an API route test')
    },
  }
  return { actors, calls, service }
}

function createFakeGenerationTaskService() {
  const actors: ProjectActor[] = []
  const calls: string[] = []
  const task: GenerationTaskResponse['task'] = {
    id: '33333333-3333-4333-8333-333333333333',
    projectId: '11111111-1111-4111-8111-111111111111',
    sourceNodeId: 'source-node',
    previewNodeId: 'preview-node',
    kind: 'image',
    providerId: 'openai',
    model: 'gpt-image-2',
    billingMode: 'workspace_key',
    status: 'queued',
    progress: 0,
    attemptCount: 0,
    maxAttempts: 3,
    errorCode: null,
    errorMessage: null,
    cancelRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
  const capture = (actor: ProjectActor, call: string) => {
    actors.push(actor)
    calls.push(call)
  }
  const service: GenerationTaskService = {
    async createTask(input, actor) {
      capture(actor, `create:${input.idempotencyKey}`)
      return { task }
    },
    async listTasks(input, actor): Promise<GenerationTasksResponse> {
      capture(actor, `list:${input.status ?? ''}:${input.limit ?? ''}`)
      return { tasks: [task], nextCursor: 'next-task-cursor' }
    },
    async getTask(taskId, actor) {
      capture(actor, `get:${taskId}`)
      return { task }
    },
    async cancelTask(taskId, input, actor) {
      capture(actor, `cancel:${taskId}:${input.idempotencyKey}`)
      return { task: { ...task, status: 'canceled', finishedAt: task.updatedAt } }
    },
    async retryTask(taskId, input, actor) {
      capture(actor, `retry:${taskId}:${input.idempotencyKey}`)
      return { task }
    },
  }
  return { actors, calls, service }
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

test('login route preserves takeover conflicts until the client confirms', async () => {
  const baseAuthService = createFakeAuthService()
  const authService: AuthService = {
    ...baseAuthService,
    async login(input) {
      if (!input.force) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: 'ACTIVE_SESSION_EXISTS',
          message: 'This account is already signed in on another device',
        })
      }

      return baseAuthService.login(input, { requestId: 'forced-login' })
    },
  }
  const server = createApiServer({ config, authService })
  const port = await listen(server)

  try {
    const conflict = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/auth/login`,
      body: { email: 'artist@example.com', password: 'long-enough-password', deviceId: 'device-b' },
    })
    assert.equal(conflict.statusCode, 409)
    assert.equal((conflict.body as { error: { code: string } }).error.code, 'ACTIVE_SESSION_EXISTS')

    const confirmed = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/auth/login`,
      body: { email: 'artist@example.com', password: 'long-enough-password', deviceId: 'device-b', force: true },
    })
    assert.equal(confirmed.statusCode, 200)
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

test('device management routes list history and remove an old device', async () => {
  const server = createApiServer({ config, authService: createFakeAuthService() })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`

  try {
    const list = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/auth/devices`,
      cookie,
    })

    assert.equal(list.statusCode, 200)
    const devices = list.body as AuthDevicesResponse
    assert.equal(devices.devices.length, 2)
    assert.equal(devices.devices[0]?.current, true)

    const removed = await requestJson(port, {
      method: 'DELETE',
      path: `${API_V1_PREFIX}/auth/devices/22222222-2222-4222-8222-222222222222`,
      cookie,
    })

    assert.equal(removed.statusCode, 200)
    assert.deepEqual(removed.body, { ok: true })
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

test('asset upload route uses the session actor and returns presigned upload metadata', async () => {
  const assets = createFakeAssetService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    assetService: assets.service,
  })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`

  try {
    const missingSession = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/assets/uploads`,
      body: {
        originalFileName: 'reference.png',
        mimeType: 'image/png',
        byteSize: 2048,
        assetKind: 'upload',
        idempotencyKey: 'asset_upload_1',
      },
    })
    assert.equal(missingSession.statusCode, 401)

    const created = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/assets/uploads`,
      cookie,
      body: {
        projectId: '11111111-1111-4111-8111-111111111111',
        originalFileName: 'reference.png',
        mimeType: 'image/png',
        byteSize: 2048,
        assetKind: 'upload',
        idempotencyKey: 'asset_upload_1',
        userId: 'forged-user',
        workspaceId: 'forged-workspace',
      },
    })

    assert.equal(created.statusCode, 201)
    const body = created.body as AssetUploadResponse
    assert.equal(body.directUpload.method, 'PUT')
    assert.equal(body.upload.assetId, body.asset.id)
    assert.equal('workspaceId' in body.asset, false)
    assert.equal('objectKey' in body.asset, false)
    assert.deepEqual(assets.actors, [{ userId: 'user_1', workspaceId: 'workspace_1' }])

    const completed = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/assets/uploads/55555555-5555-4555-8555-555555555555/complete?workspaceId=forged-workspace`,
      cookie,
    })

    assert.equal(completed.statusCode, 200)
    const completedBody = completed.body as CompleteAssetUploadResponse
    assert.equal(completedBody.asset.status, 'completed')
    assert.equal(completedBody.upload.status, 'completed')
    assert.equal('objectKey' in completedBody.asset, false)
    assert.deepEqual(assets.actors, [
      { userId: 'user_1', workspaceId: 'workspace_1' },
      { userId: 'user_1', workspaceId: 'workspace_1' },
    ])

    const assetId = '66666666-6666-4666-8666-666666666666'
    const metadata = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/assets/${assetId}?workspaceId=forged-workspace`,
      cookie,
    })
    assert.equal(metadata.statusCode, 200)
    assert.equal((metadata.body as AssetResponse).asset.id, assetId)
    assert.equal('objectKey' in (metadata.body as AssetResponse).asset, false)

    const readUrl = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/assets/${assetId}/url?userId=forged-user`,
      cookie,
    })
    assert.equal(readUrl.statusCode, 200)
    assert.equal((readUrl.body as AssetUrlResponse).assetId, assetId)
    assert.equal('headers' in (readUrl.body as AssetUrlResponse), false)
    assert(assets.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('current workspace usage route uses only the trusted session actor', async () => {
  const usage = createFakeWorkspaceUsageService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    workspaceUsageService: usage.service,
  })
  const port = await listen(server)

  try {
    const missingCookie = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/workspaces/current/usage`,
    })
    assert.equal(missingCookie.statusCode, 401)

    const response = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/workspaces/current/usage?workspaceId=forged&userId=forged`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    })
    assert.equal(response.statusCode, 200)
    assert.equal((response.body as WorkspaceUsageResponse).workspaceId, 'workspace_1')
    assert.equal((response.body as WorkspaceUsageResponse).storage.quotaBytes, 20 * 1024 * 1024 * 1024)
    assert.deepEqual(usage.actors, [{ userId: 'user_1', workspaceId: 'workspace_1' }])
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('provider settings routes use the session actor and never return the API key', async () => {
  const providers = createFakeProviderCredentialService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    providerCredentialService: providers.service,
  })
  const port = await listen(server)

  try {
    const missingCookie = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/settings/providers`,
    })
    assert.equal(missingCookie.statusCode, 401)

    const updated = await requestJson(port, {
      method: 'PUT',
      path: `${API_V1_PREFIX}/settings/providers/openai`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
      body: { apiKey: 'test-provider-secret-1234', baseUrl: 'https://api.openai.com' },
    })
    assert.equal(updated.statusCode, 200)
    assert.equal((updated.body as { provider: { secretLastFour: string } }).provider.secretLastFour, '1234')
    assert.equal(JSON.stringify(updated.body).includes('test-provider-secret'), false)

    const listed = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/settings/providers?workspaceId=forged`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    })
    assert.equal(listed.statusCode, 200)
    assert.equal((listed.body as ProviderSettingsResponse).providers[0]?.providerId, 'openai')

    const deleted = await requestJson(port, {
      method: 'DELETE',
      path: `${API_V1_PREFIX}/settings/providers/openai`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
    })
    assert.equal(deleted.statusCode, 200)
    assert.deepEqual(deleted.body, { ok: true })
    assert(providers.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))
    assert.deepEqual(providers.calls, [
      'put:openai',
      'list',
      'delete:openai',
    ])
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('generation task routes use the trusted session actor and expose only resumable task state', async () => {
  const tasks = createFakeGenerationTaskService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    generationTaskService: tasks.service,
  })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`
  const taskId = '33333333-3333-4333-8333-333333333333'
  try {
    const missingSession = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/tasks`,
    })
    assert.equal(missingSession.statusCode, 401)

    const created = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/tasks`,
      cookie,
      body: {
        projectId: '11111111-1111-4111-8111-111111111111',
        sourceNodeId: 'source-node',
        kind: 'image',
        providerId: 'openai',
        model: 'gpt-image-2',
        parameters: { prompt: 'cloud' },
        idempotencyKey: 'api-create',
        workspaceId: 'forged-workspace',
        userId: 'forged-user',
      },
    })
    assert.equal(created.statusCode, 201)
    assert.equal((created.body as GenerationTaskResponse).task.id, taskId)
    assert.equal('workspaceId' in (created.body as GenerationTaskResponse).task, false)
    assert.equal('requestJson' in (created.body as GenerationTaskResponse).task, false)

    const listed = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/tasks?status=queued&limit=1&workspaceId=forged`,
      cookie,
    })
    assert.equal(listed.statusCode, 200)
    assert.equal((listed.body as GenerationTasksResponse).nextCursor, 'next-task-cursor')
    assert.equal((await requestJson(port, { method: 'GET', path: `${API_V1_PREFIX}/tasks/${taskId}`, cookie })).statusCode, 200)
    assert.equal((await requestJson(port, {
      method: 'POST', path: `${API_V1_PREFIX}/tasks/${taskId}/cancel`, cookie,
      body: { idempotencyKey: 'api-cancel' },
    })).statusCode, 200)
    assert.equal((await requestJson(port, {
      method: 'POST', path: `${API_V1_PREFIX}/tasks/${taskId}/retry`, cookie,
      body: { idempotencyKey: 'api-retry' },
    })).statusCode, 200)

    assert(tasks.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))
    assert.deepEqual(tasks.calls, [
      'create:api-create',
      'list:queued:1',
      `get:${taskId}`,
      `cancel:${taskId}:api-cancel`,
      `retry:${taskId}:api-retry`,
    ])
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('asset upload route preserves workspace quota error details', async () => {
  const baseAssetService = createFakeAssetService().service
  const assetService: AssetService = {
    ...baseAssetService,
    async createUpload() {
      throw new AuthServiceError({
        statusCode: 409,
        apiCode: 'QUOTA_EXCEEDED',
        message: 'Workspace storage quota exceeded',
        details: {
          quotaBytes: 100,
          usedBytes: 60,
          reservedBytes: 40,
          availableBytes: 0,
          requestedBytes: 1,
        },
      })
    },
  }
  const server = createApiServer({ config, authService: createFakeAuthService(), assetService })
  const port = await listen(server)

  try {
    const response = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/assets/uploads`,
      cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`,
      body: {
        originalFileName: 'over-quota.png',
        mimeType: 'image/png',
        byteSize: 1,
        assetKind: 'upload',
        idempotencyKey: 'quota-error',
      },
    })
    assert.equal(response.statusCode, 409)
    const error = (response.body as { error: { code: string; details: Record<string, unknown> } }).error
    assert.equal(error.code, 'QUOTA_EXCEEDED')
    assert.equal(error.details.availableBytes, 0)
    assert.equal('workspaceId' in error.details, false)
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('asset read routes preserve non-disclosing two-account isolation', async () => {
  const baseAuthService = createFakeAuthService()
  const authService: AuthService = {
    ...baseAuthService,
    async getSession(context) {
      if (context.cookieHeader?.includes('session_b')) {
        return {
          user: { id: 'asset_user_b', email: 'asset-b@example.com', status: 'active', emailVerified: true },
          workspace: {
            id: 'asset_workspace_b',
            type: 'personal',
            name: 'Asset B workspace',
            role: 'owner',
            status: 'active',
            planKey: 'free',
          },
        }
      }

      if (context.cookieHeader?.includes('session_a')) {
        return {
          user: { id: 'asset_user_a', email: 'asset-a@example.com', status: 'active', emailVerified: true },
          workspace: {
            id: 'asset_workspace_a',
            type: 'personal',
            name: 'Asset A workspace',
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
  const baseAssetService = createFakeAssetService().service
  const requireOwner = (workspaceId: string) => {
    if (workspaceId !== 'asset_workspace_b') {
      throw new AuthServiceError({
        statusCode: 404,
        apiCode: 'RESOURCE_NOT_FOUND',
        message: 'Asset not found',
      })
    }
  }
  const assetService: AssetService = {
    ...baseAssetService,
    async getAsset(assetId, actor) {
      requireOwner(actor.workspaceId)
      return baseAssetService.getAsset(assetId, actor)
    },
    async getAssetUrl(assetId, actor) {
      requireOwner(actor.workspaceId)
      return baseAssetService.getAssetUrl(assetId, actor)
    },
  }
  const server = createApiServer({ config, authService, assetService })
  const port = await listen(server)
  const assetId = '66666666-6666-4666-8666-666666666666'
  const path = `${API_V1_PREFIX}/assets/${assetId}`

  try {
    assert.equal((await requestJson(port, { method: 'GET', path })).statusCode, 401)

    for (const suffix of ['', '/url']) {
      const crossAccount = await requestJson(port, {
        method: 'GET',
        path: `${path}${suffix}`,
        cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=session_a`,
      })
      assert.equal(crossAccount.statusCode, 404)
      assert.equal(
        (crossAccount.body as { error: { code: string } }).error.code,
        'RESOURCE_NOT_FOUND',
      )

      const ownerRead = await requestJson(port, {
        method: 'GET',
        path: `${path}${suffix}`,
        cookie: `${BETTER_AUTH_SESSION_COOKIE_NAME}=session_b`,
      })
      assert.equal(ownerRead.statusCode, 200)
    }
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

    const changes = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/changes?after=0&user_id=forged-user&workspace_id=forged-workspace`,
      cookie,
    })
    assert.equal(changes.statusCode, 200)
    assert.equal((changes.body as ProjectGraphChangesResponse).after, 0)

    const invalidAfter = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/changes?after=-1`,
      cookie,
    })
    assert.equal(invalidAfter.statusCode, 400)

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

    const pendingAsset = await requestJson(port, {
      method: 'PATCH',
      path,
      cookie,
      body: {
        ...operationBody,
        batchId: 'batch_asset_pending',
        idempotencyKey: 'graph_asset_pending',
        operations: [{
          type: 'upsertNode',
          node: {
            id: 'node_asset',
            nodeType: 'imageNode',
            position: { x: 0, y: 0 },
            dataSchemaVersion: 1,
            data: { imageAsset: { assetId: '44444444-4444-4444-8444-444444444444' } },
          },
        }],
      },
    })
    assert.equal(pendingAsset.statusCode, 409)
    assert.equal((pendingAsset.body as { error: { code: string } }).error.code, 'ASSET_NOT_READY')
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('project checkpoint route uses the session actor and preserves version conflicts', async () => {
  const snapshots = createFakeProjectSnapshotService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    projectSnapshotService: snapshots.service,
  })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/checkpoints`

  try {
    const missingSession = await requestJson(port, {
      method: 'POST',
      path,
      body: { expectedVersion: 1, expectedSequence: 1 },
    })
    assert.equal(missingSession.statusCode, 401)

    const created = await requestJson(port, {
      method: 'POST',
      path,
      cookie,
      body: {
        expectedVersion: 1,
        expectedSequence: 1,
        userId: 'forged-user',
        workspaceId: 'forged-workspace',
      },
    })
    assert.equal(created.statusCode, 201)
    assert.equal((created.body as ProjectCheckpointResponse).checkpoint.snapshotType, 'manual')
    assert(snapshots.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))

    const periodic = await requestJson(port, {
      method: 'POST',
      path,
      cookie,
      body: { expectedVersion: 1, expectedSequence: 1, checkpointType: 'periodic' },
    })
    assert.equal(periodic.statusCode, 201)
    assert.equal((periodic.body as ProjectCheckpointResponse).checkpoint.snapshotType, 'periodic')

    const conflict = await requestJson(port, {
      method: 'POST',
      path,
      cookie,
      body: { expectedVersion: 0, expectedSequence: 0 },
    })
    assert.equal(conflict.statusCode, 409)
    assert.equal((conflict.body as { error: { code: string } }).error.code, 'PROJECT_VERSION_CONFLICT')
    assert.equal((conflict.body as { error: { details: { currentSequence: number } } }).error.details.currentSequence, 1)
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('project revisions route uses the session actor and returns checkpoint summaries', async () => {
  const snapshots = createFakeProjectSnapshotService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    projectSnapshotService: snapshots.service,
  })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions?limit=1`

  try {
    const missingSession = await requestJson(port, { method: 'GET', path })
    assert.equal(missingSession.statusCode, 401)

    const listed = await requestJson(port, { method: 'GET', path, cookie })
    assert.equal(listed.statusCode, 200)
    const body = listed.body as ProjectRevisionsResponse
    assert.equal(body.revisions.length, 1)
    assert.equal(body.revisions[0]?.snapshotType, 'manual')
    assert.equal(body.nextCursor, 'cursor_1')
    assert.equal('recordJson' in body.revisions[0]!, false)
    assert(snapshots.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('project revision detail route uses the session actor and returns the saved record', async () => {
  const snapshots = createFakeProjectSnapshotService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    projectSnapshotService: snapshots.service,
  })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions/1`

  try {
    const detail = await requestJson(port, { method: 'GET', path, cookie })
    assert.equal(detail.statusCode, 200)
    const body = detail.body as ProjectRevisionResponse
    assert.equal(body.checkpoint.projectVersion, 1)
    assert.deepEqual(body.record.canvas.nodes, [])
    assert(snapshots.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))

    const missing = await requestJson(port, {
      method: 'GET',
      path: `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions/2`,
      cookie,
    })
    assert.equal(missing.statusCode, 404)
  } finally {
    await closeApiServer(server, 1_000)
  }
})

test('project revision restore route uses the session actor and preserves conflicts', async () => {
  const snapshots = createFakeProjectSnapshotService()
  const server = createApiServer({
    config,
    authService: createFakeAuthService(),
    projectSnapshotService: snapshots.service,
  })
  const port = await listen(server)
  const cookie = `${BETTER_AUTH_SESSION_COOKIE_NAME}=signed_session`
  const path = `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions/1/restore`

  try {
    const missingSession = await requestJson(port, {
      method: 'POST',
      path,
      body: { expectedVersion: 2, expectedSequence: 2 },
    })
    assert.equal(missingSession.statusCode, 401)

    const restored = await requestJson(port, {
      method: 'POST',
      path,
      cookie,
      body: {
        expectedVersion: 2,
        expectedSequence: 2,
        userId: 'forged-user',
        workspaceId: 'forged-workspace',
      },
    })
    assert.equal(restored.statusCode, 200)
    const body = restored.body as ProjectRevisionRestoreResponse
    assert.equal(body.restoredCheckpoint.snapshotType, 'manual')
    assert.equal(body.preRestoreCheckpoint.snapshotType, 'pre_restore')
    assert.equal(body.version, 3)
    assert(snapshots.actors.every((actor) => actor.userId === 'user_1' && actor.workspaceId === 'workspace_1'))

    const conflict = await requestJson(port, {
      method: 'POST',
      path,
      cookie,
      body: { expectedVersion: 1, expectedSequence: 1 },
    })
    assert.equal(conflict.statusCode, 409)
    assert.equal((conflict.body as { error: { code: string } }).error.code, 'PROJECT_VERSION_CONFLICT')
    assert.equal((conflict.body as { error: { details: { currentSequence: number } } }).error.details.currentSequence, 2)

    const unavailableAsset = await requestJson(port, {
      method: 'POST',
      path: `${API_V1_PREFIX}/projects/11111111-1111-4111-8111-111111111111/revisions/3/restore`,
      cookie,
      body: { expectedVersion: 2, expectedSequence: 2 },
    })
    assert.equal(unavailableAsset.statusCode, 409)
    assert.equal((unavailableAsset.body as { error: { code: string } }).error.code, 'ASSET_NOT_READY')
  } finally {
    await closeApiServer(server, 1_000)
  }
})
