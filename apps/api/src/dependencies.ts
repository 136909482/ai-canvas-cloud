import net from 'node:net'
import { URL } from 'node:url'
import type { HealthDependencyStatus } from '@ai-canvas-cloud/contracts'
import type { ApiConfig } from './config.js'

const DEFAULT_TIMEOUT_MS = 1_500

async function measure(check: () => Promise<void>): Promise<HealthDependencyStatus> {
  const startedAt = performance.now()

  try {
    await check()
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt),
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.name : 'UnknownError',
    }
  }
}

function checkTcp(urlValue: string, defaultPort: number) {
  const url = new URL(urlValue)
  const port = url.port ? Number(url.port) : defaultPort

  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port })
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Timed out connecting to ${url.hostname}:${port}`))
    }, DEFAULT_TIMEOUT_MS)

    socket.once('connect', () => {
      clearTimeout(timeout)
      socket.end()
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

async function checkHttp(urlValue: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(new URL('/minio/health/ready', urlValue), {
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkReadinessDependencies(config: ApiConfig, checks?: {
  postgres?: () => Promise<void>
  objectStorage?: () => Promise<void>
  redis?: () => Promise<void>
}) {
  const [postgres, redis, objectStorage] = await Promise.all([
    measure(() => checks?.postgres?.() ?? checkTcp(config.databaseUrl, 5432)),
    measure(() => checks?.redis?.() ?? checkTcp(config.redisUrl, 6379)),
    measure(() => checks?.objectStorage?.() ?? checkHttp(config.s3Endpoint)),
  ])

  return {
    postgres,
    redis,
    objectStorage,
  }
}
