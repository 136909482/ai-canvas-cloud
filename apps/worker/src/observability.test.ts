import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createMetricsRegistry, type Logger } from '@ai-canvas-cloud/shared'
import { closeWorkerObservabilityServer, createWorkerObservabilityServer } from './observability.ts'

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} }

async function get(server: http.Server, path: string) {
  const address = server.address()
  assert(address && typeof address === 'object')
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`)
  return { status: response.status, body: await response.text() }
}

test('Worker readiness exposes dependency failure and recovery without diagnostic secrets', async () => {
  let redisUp = false
  const metrics = createMetricsRegistry()
  const server = createWorkerObservabilityServer({
    metrics,
    logger,
    checks: {
      async postgres() {},
      async redis() { if (!redisUp) throw new Error('redis://user:secret@private.example') },
      async objectStorage() {},
    },
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const degraded = await get(server, '/health/ready')
    assert.equal(degraded.status, 503)
    assert.match(degraded.body, /"status":"degraded"/)
    assert.doesNotMatch(degraded.body, /secret|private\.example/)
    assert.match((await get(server, '/metrics')).body, /ai_canvas_dependency_up\{dependency="redis"\} 0/)

    redisUp = true
    assert.equal((await get(server, '/health/ready')).status, 200)
    assert.match((await get(server, '/metrics')).body, /ai_canvas_dependency_up\{dependency="redis"\} 1/)
  } finally {
    await closeWorkerObservabilityServer(server)
  }
})
