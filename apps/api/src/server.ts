import http from 'node:http'
import {
  API_V1_PREFIX,
  createServiceUnavailableError,
  type ApiErrorResponse,
  type ApplyProjectGraphOperationsRequest,
  type AuthSessionsResponse,
  type CreateAssetUploadRequest,
  type CreateProjectCheckpointRequest,
  type CurrentWorkspaceResponse,
  type EmailVerificationResponse,
  type EmailVerifyRequest,
  type HealthResponse,
  type LoginRequest,
  type LogoutResponse,
  type PasswordForgotRequest,
  type PasswordResetRequest,
  type PasswordResetResponse,
  type CreateProjectRequest,
  type ProjectListStatus,
  type RenameProjectRequest,
  type RegisterRequest,
  type RestoreProjectRevisionRequest,
  type RevokeSessionResponse,
  type PutProviderCredentialRequest,
  type CreateGenerationTaskRequest,
  type GenerationTaskCommandRequest,
} from '@ai-canvas-cloud/contracts'
import {
  createUnavailableAssetService,
  type AssetService,
} from '@ai-canvas-cloud/server/modules/assets'
import {
  AuthServiceError,
  createUnavailableAuthService,
  type AuthRequestContext,
  type AuthService,
} from '@ai-canvas-cloud/server/modules/auth'
import {
  createUnavailableProjectGraphService,
  validateProjectGraphChangesAfter,
  type ProjectGraphService,
} from '@ai-canvas-cloud/server/modules/project-graph'
import {
  createUnavailableProjectSnapshotService,
  type ProjectSnapshotService,
} from '@ai-canvas-cloud/server/modules/project-snapshots'
import {
  createUnavailableProjectService,
  type ProjectService,
} from '@ai-canvas-cloud/server/modules/projects'
import {
  createUnavailableProviderCredentialService,
  type ProviderCredentialService,
} from '@ai-canvas-cloud/server/modules/providers'
import {
  createUnavailableGenerationTaskService,
  type GenerationTaskService,
} from '@ai-canvas-cloud/server/modules/tasks'
import {
  createUnavailableWorkspaceUsageService,
  type WorkspaceUsageService,
} from '@ai-canvas-cloud/server/modules/workspaces'
import { createJsonLogger, createRequestId, type Logger } from '@ai-canvas-cloud/shared'
import type { ApiConfig } from './config.js'
import { checkReadinessDependencies } from './dependencies.js'

interface ServerOptions {
  config: ApiConfig
  logger?: Logger
  authService?: AuthService
  assetService?: AssetService
  projectGraphService?: ProjectGraphService
  projectSnapshotService?: ProjectSnapshotService
  projectService?: ProjectService
  workspaceUsageService?: WorkspaceUsageService
  providerCredentialService?: ProviderCredentialService
  generationTaskService?: GenerationTaskService
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown, requestId: string) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('x-request-id', requestId)
  response.end(JSON.stringify(payload))
}

function sendApiError(response: http.ServerResponse, statusCode: number, error: ApiErrorResponse, requestId: string) {
  sendJson(response, statusCode, error, requestId)
}

function isLivePath(pathname: string) {
  return pathname === '/health/live' || pathname === `${API_V1_PREFIX}/health/live`
}

function isReadyPath(pathname: string) {
  return pathname === '/health/ready' || pathname === `${API_V1_PREFIX}/health/ready`
}

function isAuthPath(pathname: string, route: string) {
  return pathname === `${API_V1_PREFIX}/auth/${route}`
}

function isWorkspacePath(pathname: string, route: string) {
  return pathname === `${API_V1_PREFIX}/workspaces/${route}`
}

function isAssetPath(pathname: string, route: string) {
  return pathname === `${API_V1_PREFIX}/assets/${route}`
}

function getAssetUploadCompleteId(pathname: string) {
  const prefix = `${API_V1_PREFIX}/assets/uploads/`

  if (!pathname.startsWith(prefix) || !pathname.endsWith('/complete')) {
    return null
  }

  const uploadId = pathname.slice(prefix.length, -'/complete'.length)
  return uploadId ? decodeURIComponent(uploadId) : null
}

function getAssetReadRoute(pathname: string) {
  const prefix = `${API_V1_PREFIX}/assets/`

  if (!pathname.startsWith(prefix)) {
    return null
  }

  const segments = pathname.slice(prefix.length).split('/')
  if (!segments[0] || segments[0] === 'uploads' || segments.length > 2) {
    return null
  }

  if (segments.length === 2 && segments[1] !== 'url') {
    return null
  }

  try {
    return {
      assetId: decodeURIComponent(segments[0]),
      action: segments[1] ?? null,
    }
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Invalid asset path',
    })
  }
}

function getAuthSessionIdFromPath(pathname: string) {
  const prefix = `${API_V1_PREFIX}/auth/sessions/`

  if (!pathname.startsWith(prefix)) {
    return null
  }

  const sessionId = pathname.slice(prefix.length)
  return sessionId ? decodeURIComponent(sessionId) : null
}

function getProviderSettingsRoute(pathname: string) {
  const collectionPath = `${API_V1_PREFIX}/settings/providers`
  if (pathname === collectionPath) {
    return { providerId: null }
  }
  const prefix = `${collectionPath}/`
  if (!pathname.startsWith(prefix)) {
    return null
  }
  const providerId = pathname.slice(prefix.length)
  if (!providerId || providerId.includes('/')) {
    return null
  }
  try {
    return { providerId: decodeURIComponent(providerId) }
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Invalid provider path',
    })
  }
}

function getGenerationTaskRoute(pathname: string): { taskId: string | null; action: 'cancel' | 'retry' | null } | null {
  const collectionPath = `${API_V1_PREFIX}/tasks`
  if (pathname === collectionPath) {
    return { taskId: null, action: null }
  }
  const prefix = `${collectionPath}/`
  if (!pathname.startsWith(prefix)) {
    return null
  }
  const segments = pathname.slice(prefix.length).split('/')
  if (!segments[0] || segments.length > 2 || (segments[1] && !['cancel', 'retry'].includes(segments[1]))) {
    return null
  }
  try {
    return {
      taskId: decodeURIComponent(segments[0]),
      action: (segments[1] as 'cancel' | 'retry' | undefined) ?? null,
    }
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Invalid task path',
    })
  }
}

function getProjectRoute(pathname: string) {
  const prefix = `${API_V1_PREFIX}/projects/`

  if (!pathname.startsWith(prefix)) {
    return null
  }

  const segments = pathname.slice(prefix.length).split('/')

  if (segments.length < 1 || segments.length > 4 || !segments[0]) {
    return null
  }

  try {
    return {
      projectId: decodeURIComponent(segments[0]),
      action: segments[1] ?? null,
      subresourceId: segments[2] ? decodeURIComponent(segments[2]) : null,
      subresourceAction: segments[3] ? decodeURIComponent(segments[3]) : null,
    }
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Invalid project path',
    })
  }
}

function createErrorResponse(requestId: string, error: AuthServiceError): ApiErrorResponse {
  return {
    error: {
      code: error.apiCode,
      message: error.message,
      retryable: error.retryable,
      requestId,
      details: error.details,
    },
  }
}

async function readJsonBody<T>(request: http.IncomingMessage, maxBytes = 64 * 1024): Promise<T> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength

    if (totalBytes > maxBytes) {
      throw new AuthServiceError({
        statusCode: 413,
        apiCode: 'VALIDATION_FAILED',
        message: 'Request body is too large',
      })
    }

    chunks.push(buffer)
  }

  const text = Buffer.concat(chunks).toString('utf8')

  if (!text.trim()) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Request body is required',
    })
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: 'VALIDATION_FAILED',
      message: 'Request body must be valid JSON',
    })
  }
}

function getAuthContext(request: http.IncomingMessage, requestId: string): AuthRequestContext {
  return {
    requestId,
    userAgent: request.headers['user-agent'] ?? null,
    ipAddress: request.socket.remoteAddress ?? null,
    cookieHeader: request.headers.cookie ?? null,
  }
}

function setCookieHeaders(response: http.ServerResponse, setCookieHeaders: string[]) {
  if (setCookieHeaders.length > 0) {
    response.setHeader('set-cookie', setCookieHeaders)
  }
}

async function handleAuthRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
) {
  const context = getAuthContext(request, requestId)

  try {
    if (request.method === 'POST' && isAuthPath(requestUrl.pathname, 'register')) {
      const result = await authService.register(await readJsonBody<RegisterRequest>(request), context)
      setCookieHeaders(response, result.setCookieHeaders)
      sendJson(response, 201, result.response, requestId)
      return true
    }

    if (request.method === 'POST' && isAuthPath(requestUrl.pathname, 'login')) {
      const result = await authService.login(await readJsonBody<LoginRequest>(request), context)
      setCookieHeaders(response, result.setCookieHeaders)
      sendJson(response, 200, result.response, requestId)
      return true
    }

    if (request.method === 'GET' && isAuthPath(requestUrl.pathname, 'session')) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: 'AUTH_REQUIRED',
          message: 'Authentication required',
        })
      }

      sendJson(response, 200, await authService.getSession(context), requestId)
      return true
    }

    if (request.method === 'POST' && isAuthPath(requestUrl.pathname, 'logout')) {
      if (context.cookieHeader) {
        const result = await authService.logout(context)
        setCookieHeaders(response, result.setCookieHeaders)
      }

      const payload: LogoutResponse = { ok: true }
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (request.method === 'GET' && isAuthPath(requestUrl.pathname, 'sessions')) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: 'AUTH_REQUIRED',
          message: 'Authentication required',
        })
      }

      const payload: AuthSessionsResponse = await authService.listSessions(context)
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (request.method === 'POST' && isAuthPath(requestUrl.pathname, 'email/resend')) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: 'AUTH_REQUIRED',
          message: 'Authentication required',
        })
      }

      const payload: EmailVerificationResponse = await authService.resendVerificationEmail(context)
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (request.method === 'POST' && isAuthPath(requestUrl.pathname, 'email/verify')) {
      const payload: EmailVerificationResponse = await authService.verifyEmail(
        await readJsonBody<EmailVerifyRequest>(request),
        context,
      )
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (request.method === 'POST' && isAuthPath(requestUrl.pathname, 'password/forgot')) {
      const payload: PasswordResetResponse = await authService.requestPasswordReset(
        await readJsonBody<PasswordForgotRequest>(request),
        context,
      )
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (request.method === 'POST' && isAuthPath(requestUrl.pathname, 'password/reset')) {
      const payload: PasswordResetResponse = await authService.resetPassword(
        await readJsonBody<PasswordResetRequest>(request),
        context,
      )
      sendJson(response, 200, payload, requestId)
      return true
    }

    const sessionId = getAuthSessionIdFromPath(requestUrl.pathname)

    if (request.method === 'DELETE' && sessionId) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: 'AUTH_REQUIRED',
          message: 'Authentication required',
        })
      }

      const result = await authService.revokeSession(sessionId, context)
      setCookieHeaders(response, result.setCookieHeaders)
      const payload: RevokeSessionResponse = result.response
      sendJson(response, 200, payload, requestId)
      return true
    }

    return false
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(response, error.statusCode, createErrorResponse(requestId, error), requestId)
      return true
    }

    throw error
  }
}

async function handleWorkspaceRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  workspaceUsageService: WorkspaceUsageService,
) {
  const context = getAuthContext(request, requestId)

  try {
    if (request.method === 'GET' && isWorkspacePath(requestUrl.pathname, 'current')) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: 'AUTH_REQUIRED',
          message: 'Authentication required',
        })
      }

      const session = await authService.getSession(context)
      const payload: CurrentWorkspaceResponse = {
        workspace: session.workspace,
      }
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (request.method === 'GET' && isWorkspacePath(requestUrl.pathname, 'current/usage')) {
      if (!context.cookieHeader) {
        throw new AuthServiceError({
          statusCode: 401,
          apiCode: 'AUTH_REQUIRED',
          message: 'Authentication required',
        })
      }

      const session = await authService.getSession(context)
      const payload = await workspaceUsageService.getCurrentUsage({
        userId: session.user.id,
        workspaceId: session.workspace.id,
      })
      sendJson(response, 200, payload, requestId)
      return true
    }

    return false
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(response, error.statusCode, createErrorResponse(requestId, error), requestId)
      return true
    }

    throw error
  }
}

async function handleProjectRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  projectGraphService: ProjectGraphService,
  projectSnapshotService: ProjectSnapshotService,
  projectService: ProjectService,
) {
  const isCollectionPath = requestUrl.pathname === `${API_V1_PREFIX}/projects`

  if (!isCollectionPath && !requestUrl.pathname.startsWith(`${API_V1_PREFIX}/projects/`)) {
    return false
  }

  const context = getAuthContext(request, requestId)

  try {
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: 'AUTH_REQUIRED',
        message: 'Authentication required',
      })
    }

    const session = await authService.getSession(context)
    const actor = {
      userId: session.user.id,
      workspaceId: session.workspace.id,
    }

    if (isCollectionPath && request.method === 'GET') {
      const statusValue = requestUrl.searchParams.get('status')
      const limitValue = requestUrl.searchParams.get('limit')
      const payload = await projectService.listProjects({
        status: statusValue === null ? undefined : statusValue as ProjectListStatus,
        cursor: requestUrl.searchParams.get('cursor'),
        limit: limitValue === null ? undefined : Number(limitValue),
      }, actor)
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (isCollectionPath && request.method === 'POST') {
      const payload = await projectService.createProject(
        await readJsonBody<CreateProjectRequest>(request),
        actor,
      )
      sendJson(response, 201, payload, requestId)
      return true
    }

    const route = getProjectRoute(requestUrl.pathname)

    if (!route) {
      return false
    }

    if (route.action === 'graph' && request.method === 'GET') {
      sendJson(response, 200, await projectGraphService.getGraph(route.projectId, actor), requestId)
      return true
    }

    if (route.action === 'graph' && request.method === 'PATCH') {
      const payload = await projectGraphService.applyOperations(
        route.projectId,
        await readJsonBody<ApplyProjectGraphOperationsRequest>(request, 2 * 1024 * 1024),
        actor,
      )
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (route.action === 'changes' && request.method === 'GET') {
      const after = validateProjectGraphChangesAfter(requestUrl.searchParams.get('after'))
      sendJson(response, 200, await projectGraphService.getChanges(route.projectId, after, actor), requestId)
      return true
    }

    if (route.action === 'checkpoints' && request.method === 'POST') {
      const payload = await projectSnapshotService.createCheckpoint(
        route.projectId,
        await readJsonBody<CreateProjectCheckpointRequest>(request),
        actor,
      )
      sendJson(response, 201, payload, requestId)
      return true
    }

    if (route.action === 'revisions' && request.method === 'GET') {
      if (route.subresourceId && !route.subresourceAction) {
        const payload = await projectSnapshotService.getRevision(
          route.projectId,
          Number(route.subresourceId),
          actor,
        )
        sendJson(response, 200, payload, requestId)
        return true
      }

      const limitValue = requestUrl.searchParams.get('limit')
      const payload = await projectSnapshotService.listRevisions(route.projectId, {
        cursor: requestUrl.searchParams.get('cursor'),
        limit: limitValue === null ? undefined : Number(limitValue),
      }, actor)
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (
      route.action === 'revisions'
      && route.subresourceId
      && route.subresourceAction === 'restore'
      && request.method === 'POST'
    ) {
      const payload = await projectSnapshotService.restoreRevision(
        route.projectId,
        Number(route.subresourceId),
        await readJsonBody<RestoreProjectRevisionRequest>(request),
        actor,
      )
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (route.action === null && request.method === 'GET') {
      sendJson(response, 200, await projectService.getProject(route.projectId, actor), requestId)
      return true
    }

    if (route.action === null && request.method === 'PATCH') {
      const payload = await projectService.renameProject(
        route.projectId,
        await readJsonBody<RenameProjectRequest>(request),
        actor,
      )
      sendJson(response, 200, payload, requestId)
      return true
    }

    if (route.action === 'archive' && request.method === 'POST') {
      sendJson(response, 200, await projectService.archiveProject(route.projectId, actor), requestId)
      return true
    }

    if (route.action === 'restore' && request.method === 'POST') {
      sendJson(response, 200, await projectService.restoreProject(route.projectId, actor), requestId)
      return true
    }

    if (route.action === null && request.method === 'DELETE') {
      sendJson(response, 200, await projectService.deleteProject(route.projectId, actor), requestId)
      return true
    }

    return false
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(response, error.statusCode, createErrorResponse(requestId, error), requestId)
      return true
    }

    throw error
  }
}

async function handleAssetRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  assetService: AssetService,
) {
  if (!requestUrl.pathname.startsWith(`${API_V1_PREFIX}/assets/`)) {
    return false
  }

  const context = getAuthContext(request, requestId)

  try {
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: 'AUTH_REQUIRED',
        message: 'Authentication required',
      })
    }

    const session = await authService.getSession(context)
    const actor = {
      userId: session.user.id,
      workspaceId: session.workspace.id,
    }

    if (request.method === 'POST' && isAssetPath(requestUrl.pathname, 'uploads')) {
      const payload = await assetService.createUpload(
        await readJsonBody<CreateAssetUploadRequest>(request),
        actor,
      )
      sendJson(response, 201, payload, requestId)
      return true
    }

    const completeUploadId = getAssetUploadCompleteId(requestUrl.pathname)
    if (request.method === 'POST' && completeUploadId) {
      const payload = await assetService.completeUpload(completeUploadId, actor)
      sendJson(response, 200, payload, requestId)
      return true
    }

    const assetReadRoute = getAssetReadRoute(requestUrl.pathname)
    if (request.method === 'GET' && assetReadRoute?.action === null) {
      sendJson(response, 200, await assetService.getAsset(assetReadRoute.assetId, actor), requestId)
      return true
    }

    if (request.method === 'GET' && assetReadRoute?.action === 'url') {
      sendJson(response, 200, await assetService.getAssetUrl(assetReadRoute.assetId, actor), requestId)
      return true
    }

    return false
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(response, error.statusCode, createErrorResponse(requestId, error), requestId)
      return true
    }

    throw error
  }
}

async function handleProviderSettingsRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  providerCredentialService: ProviderCredentialService,
) {
  const route = getProviderSettingsRoute(requestUrl.pathname)
  if (!route) {
    return false
  }
  const context = getAuthContext(request, requestId)
  try {
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: 'AUTH_REQUIRED',
        message: 'Authentication required',
      })
    }
    const session = await authService.getSession(context)
    const actor = { userId: session.user.id, workspaceId: session.workspace.id }

    if (request.method === 'GET' && route.providerId === null) {
      sendJson(response, 200, await providerCredentialService.listProviders(actor), requestId)
      return true
    }
    if (request.method === 'PUT' && route.providerId) {
      const payload = await providerCredentialService.putProvider(
        route.providerId,
        await readJsonBody<PutProviderCredentialRequest>(request),
        actor,
      )
      sendJson(response, 200, payload, requestId)
      return true
    }
    if (request.method === 'DELETE' && route.providerId) {
      sendJson(response, 200, await providerCredentialService.deleteProvider(route.providerId, actor), requestId)
      return true
    }
    return false
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(response, error.statusCode, createErrorResponse(requestId, error), requestId)
      return true
    }
    throw error
  }
}

async function handleGenerationTaskRoute(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  requestId: string,
  authService: AuthService,
  generationTaskService: GenerationTaskService,
) {
  const route = getGenerationTaskRoute(requestUrl.pathname)
  if (!route) {
    return false
  }
  const context = getAuthContext(request, requestId)
  try {
    if (!context.cookieHeader) {
      throw new AuthServiceError({
        statusCode: 401,
        apiCode: 'AUTH_REQUIRED',
        message: 'Authentication required',
      })
    }
    const session = await authService.getSession(context)
    const actor = { userId: session.user.id, workspaceId: session.workspace.id }

    if (request.method === 'POST' && route.taskId === null) {
      const payload = await generationTaskService.createTask(
        await readJsonBody<CreateGenerationTaskRequest>(request, 320 * 1024),
        actor,
      )
      sendJson(response, 201, payload, requestId)
      return true
    }
    if (request.method === 'GET' && route.taskId === null) {
      const rawLimit = requestUrl.searchParams.get('limit')
      const limit = rawLimit === null ? undefined : Number(rawLimit)
      sendJson(response, 200, await generationTaskService.listTasks({
        projectId: requestUrl.searchParams.get('projectId'),
        status: requestUrl.searchParams.get('status'),
        cursor: requestUrl.searchParams.get('cursor'),
        ...(limit === undefined ? {} : { limit }),
      }, actor), requestId)
      return true
    }
    if (request.method === 'GET' && route.taskId && route.action === null) {
      sendJson(response, 200, await generationTaskService.getTask(route.taskId, actor), requestId)
      return true
    }
    if (request.method === 'POST' && route.taskId && route.action) {
      const input = await readJsonBody<GenerationTaskCommandRequest>(request)
      const payload = route.action === 'cancel'
        ? await generationTaskService.cancelTask(route.taskId, input, actor)
        : await generationTaskService.retryTask(route.taskId, input, actor)
      sendJson(response, 200, payload, requestId)
      return true
    }
    return false
  } catch (error) {
    if (error instanceof AuthServiceError) {
      sendApiError(response, error.statusCode, createErrorResponse(requestId, error), requestId)
      return true
    }
    throw error
  }
}

export function createApiServer({
  config,
  logger = createJsonLogger({ level: config.logLevel, service: 'api' }),
  authService = createUnavailableAuthService(),
  assetService = createUnavailableAssetService(),
  projectGraphService = createUnavailableProjectGraphService(),
  projectSnapshotService = createUnavailableProjectSnapshotService(),
  projectService = createUnavailableProjectService(),
  workspaceUsageService = createUnavailableWorkspaceUsageService(),
  providerCredentialService = createUnavailableProviderCredentialService(),
  generationTaskService = createUnavailableGenerationTaskService(),
}: ServerOptions) {
  const server = http.createServer(async (request, response) => {
    const requestId = createRequestId()
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    logger.info('request.received', {
      requestId,
      method: request.method,
      path: requestUrl.pathname,
    })

    if (isLivePath(requestUrl.pathname)) {
      if (request.method !== 'GET') {
        sendJson(response, 404, createServiceUnavailableError(requestId, 'Route not found'), requestId)
        return
      }

      const payload: HealthResponse = {
        status: 'ok',
        service: 'api',
        requestId,
        uptimeSeconds: Math.round(process.uptime()),
        checkedAt: new Date().toISOString(),
      }
      sendJson(response, 200, payload, requestId)
      return
    }

    if (isReadyPath(requestUrl.pathname)) {
      if (request.method !== 'GET') {
        sendJson(response, 404, createServiceUnavailableError(requestId, 'Route not found'), requestId)
        return
      }

      const dependencies = await checkReadinessDependencies(config)
      const ok = Object.values(dependencies).every((dependency) => dependency.ok)
      const payload: HealthResponse = {
        status: ok ? 'ok' : 'degraded',
        service: 'api',
        requestId,
        uptimeSeconds: Math.round(process.uptime()),
        checkedAt: new Date().toISOString(),
        dependencies,
      }
      sendJson(response, ok ? 200 : 503, payload, requestId)
      return
    }

    if (await handleAuthRoute(request, response, requestUrl, requestId, authService)) {
      return
    }

    if (await handleWorkspaceRoute(
      request,
      response,
      requestUrl,
      requestId,
      authService,
      workspaceUsageService,
    )) {
      return
    }

    if (await handleAssetRoute(request, response, requestUrl, requestId, authService, assetService)) {
      return
    }

    if (await handleProviderSettingsRoute(
      request,
      response,
      requestUrl,
      requestId,
      authService,
      providerCredentialService,
    )) {
      return
    }

    if (await handleGenerationTaskRoute(
      request,
      response,
      requestUrl,
      requestId,
      authService,
      generationTaskService,
    )) {
      return
    }

    if (await handleProjectRoute(
      request,
      response,
      requestUrl,
      requestId,
      authService,
      projectGraphService,
      projectSnapshotService,
      projectService,
    )) {
      return
    }

    sendJson(response, 404, createServiceUnavailableError(requestId, 'Route not found'), requestId)
  })

  return server
}

export async function closeApiServer(server: http.Server, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out closing API server')), timeoutMs)
    server.close((error) => {
      clearTimeout(timeout)
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}
