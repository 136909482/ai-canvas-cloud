import http from 'node:http'
import { API_V1_PREFIX, createServiceUnavailableError, type HealthResponse } from '@ai-canvas-cloud/contracts'
import { createJsonLogger, createRequestId, type Logger } from '@ai-canvas-cloud/shared'
import type { ApiConfig } from './config.js'
import { checkReadinessDependencies } from './dependencies.js'

interface ServerOptions {
  config: ApiConfig
  logger?: Logger
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown, requestId: string) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('x-request-id', requestId)
  response.end(JSON.stringify(payload))
}

function isLivePath(pathname: string) {
  return pathname === '/health/live' || pathname === `${API_V1_PREFIX}/health/live`
}

function isReadyPath(pathname: string) {
  return pathname === '/health/ready' || pathname === `${API_V1_PREFIX}/health/ready`
}

export function createApiServer({ config, logger = createJsonLogger({ level: config.logLevel, service: 'api' }) }: ServerOptions) {
  const server = http.createServer(async (request, response) => {
    const requestId = createRequestId()
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    logger.info('request.received', {
      requestId,
      method: request.method,
      path: requestUrl.pathname,
    })

    if (request.method !== 'GET') {
      sendJson(response, 404, createServiceUnavailableError(requestId, 'Route not found'), requestId)
      return
    }

    if (isLivePath(requestUrl.pathname)) {
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
