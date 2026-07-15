import http from 'node:http'
import {
  API_V1_PREFIX,
  createServiceUnavailableError,
  type ApiErrorResponse,
  type ApplyProjectGraphOperationsRequest,
  type AuthSessionsResponse,
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
  type RevokeSessionResponse,
} from '@ai-canvas-cloud/contracts'
import {
  AuthServiceError,
  createUnavailableAuthService,
  type AuthRequestContext,
  type AuthService,
} from '@ai-canvas-cloud/server/modules/auth'
import {
  createUnavailableProjectGraphService,
  type ProjectGraphService,
} from '@ai-canvas-cloud/server/modules/project-graph'
import {
  createUnavailableProjectService,
  type ProjectService,
} from '@ai-canvas-cloud/server/modules/projects'
import { createJsonLogger, createRequestId, type Logger } from '@ai-canvas-cloud/shared'
import type { ApiConfig } from './config.js'
import { checkReadinessDependencies } from './dependencies.js'

interface ServerOptions {
  config: ApiConfig
  logger?: Logger
  authService?: AuthService
  projectGraphService?: ProjectGraphService
  projectService?: ProjectService
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

function getAuthSessionIdFromPath(pathname: string) {
  const prefix = `${API_V1_PREFIX}/auth/sessions/`

  if (!pathname.startsWith(prefix)) {
    return null
  }

  const sessionId = pathname.slice(prefix.length)
  return sessionId ? decodeURIComponent(sessionId) : null
}

function getProjectRoute(pathname: string) {
  const prefix = `${API_V1_PREFIX}/projects/`

  if (!pathname.startsWith(prefix)) {
    return null
  }

  const segments = pathname.slice(prefix.length).split('/')

  if (segments.length < 1 || segments.length > 2 || !segments[0]) {
    return null
  }

  try {
    return {
      projectId: decodeURIComponent(segments[0]),
      action: segments[1] ?? null,
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

export function createApiServer({
  config,
  logger = createJsonLogger({ level: config.logLevel, service: 'api' }),
  authService = createUnavailableAuthService(),
  projectGraphService = createUnavailableProjectGraphService(),
  projectService = createUnavailableProjectService(),
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

    if (await handleWorkspaceRoute(request, response, requestUrl, requestId, authService)) {
      return
    }

    if (await handleProjectRoute(
      request,
      response,
      requestUrl,
      requestId,
      authService,
      projectGraphService,
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
