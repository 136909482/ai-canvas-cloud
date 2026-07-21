import http from 'node:http'
import { measureDependencyCheck, type Logger, type MetricsRegistry } from '@ai-canvas-cloud/shared'

export interface WorkerDependencyChecks {
  postgres: () => Promise<void>
  redis: () => Promise<void>
  objectStorage: () => Promise<void>
}

export function createWorkerObservabilityServer(options: {
  metrics: MetricsRegistry
  checks: WorkerDependencyChecks
  logger: Logger
}) {
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
    if (request.method !== 'GET') {
      response.writeHead(404).end()
      return
    }
    if (pathname === '/metrics') {
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
      response.end(options.metrics.renderPrometheus())
      return
    }
    if (pathname === '/health/live') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ status: 'ok', service: 'worker' }))
      return
    }
    if (pathname === '/health/ready') {
      const entries = await Promise.all(Object.entries(options.checks).map(async ([dependency, check]) => (
        [dependency, await measureDependencyCheck(check)] as const
      )))
      const dependencies = Object.fromEntries(entries)
      for (const [dependency, status] of entries) {
        options.metrics.setGauge('dependency_up', status.ok ? 1 : 0, { dependency })
      }
      const ok = entries.every(([, status]) => status.ok)
      response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ status: ok ? 'ok' : 'degraded', service: 'worker', dependencies }))
      return
    }
    response.writeHead(404).end()
  }).on('clientError', (error) => {
    options.logger.warn('worker.observability.client_error', { error: error.name })
  })
}

export async function closeWorkerObservabilityServer(server: http.Server) {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
