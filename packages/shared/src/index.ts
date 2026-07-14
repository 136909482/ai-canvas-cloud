export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export function readRequiredEnv(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value.trim()
}

export function readOptionalEnv(env: NodeJS.ProcessEnv, key: string, fallback: string) {
  const value = env[key]
  return value && value.trim().length > 0 ? value.trim() : fallback
}

export function readPortEnv(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const raw = env[key]

  if (!raw || raw.trim().length === 0) {
    return fallback
  }

  const port = Number(raw)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in ${key}: ${raw}`)
  }

  return port
}

export function readPositiveIntegerEnv(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const raw = env[key]

  if (!raw || raw.trim().length === 0) {
    return fallback
  }

  const value = Number(raw)

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid positive integer in ${key}: ${raw}`)
  }

  return value
}

export function createRequestId(prefix = 'req') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
}

export function createJsonLogger(options?: { level?: LogLevel; service?: string }): Logger {
  const minimumLevel = options?.level ?? 'info'
  const service = options?.service ?? 'ai-canvas-cloud'

  function write(level: LogLevel, message: string, context: Record<string, unknown> = {}) {
    if (levelRank[level] < levelRank[minimumLevel]) {
      return
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...context,
    }

    const line = JSON.stringify(payload)

    if (level === 'error') {
      console.error(line)
      return
    }

    if (level === 'warn') {
      console.warn(line)
      return
    }

    console.log(line)
  }

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  }
}
