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

export function hasDuplicateJsonObjectKeys(text: string) {
  let index = 0

  function skipWhitespace() {
    while (/\s/.test(text[index] ?? '')) index += 1
  }

  function parseString() {
    if (text[index] !== '"') return null
    const start = index
    index += 1
    let escaped = false
    while (index < text.length) {
      const character = text[index++]
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') {
        try {
          return JSON.parse(text.slice(start, index)) as string
        } catch {
          return null
        }
      }
    }
    return null
  }

  function parseValue(): boolean {
    skipWhitespace()
    const character = text[index]
    if (character === '"') {
      parseString()
      return false
    }
    if (character === '{') return parseObject()
    if (character === '[') return parseArray()
    while (index < text.length && !/[\s,\]}]/.test(text[index]!)) index += 1
    return false
  }

  function parseObject(): boolean {
    index += 1
    const keys = new Set<string>()
    skipWhitespace()
    if (text[index] === '}') {
      index += 1
      return false
    }
    while (index < text.length) {
      skipWhitespace()
      const key = parseString()
      if (key === null) return false
      if (keys.has(key)) return true
      keys.add(key)
      skipWhitespace()
      if (text[index] !== ':') return false
      index += 1
      if (parseValue()) return true
      skipWhitespace()
      if (text[index] === ',') {
        index += 1
        continue
      }
      if (text[index] === '}') {
        index += 1
        return false
      }
      return false
    }
    return false
  }

  function parseArray(): boolean {
    index += 1
    skipWhitespace()
    if (text[index] === ']') {
      index += 1
      return false
    }
    while (index < text.length) {
      if (parseValue()) return true
      skipWhitespace()
      if (text[index] === ',') {
        index += 1
        continue
      }
      if (text[index] === ']') {
        index += 1
        return false
      }
      return false
    }
    return false
  }

  return parseValue()
}

const SENSITIVE_LOG_KEY_PATTERN = /(?:authorization|cookie|password|secret|token|api[_-]?key|access[_-]?key|signed[_-]?url|upload[_-]?url|download[_-]?url|object[_-]?key|provider[_-]?(?:response|body)|request[_-]?body|response[_-]?body)/i
const SENSITIVE_LOG_TEXT_PATTERN = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+|\b(?:password|pass|token|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi
const URL_PATTERN = /\b(?:https?|s?3|rediss?):\/\/[^\s"'<>]+/gi

function redactLogString(value: string) {
  const withoutCredentials = value.replace(SENSITIVE_LOG_TEXT_PATTERN, (match) => {
    const separator = match.match(/\s*[:=]\s*/)?.[0]
    return separator ? `${match.slice(0, match.indexOf(separator))}${separator}[redacted]` : '[redacted]'
  })
  return withoutCredentials.replace(URL_PATTERN, (match) => {
    try {
      const url = new URL(match)
      return `${url.protocol}//${url.host}/[redacted]`
    } catch {
      return '[redacted-url]'
    }
  })
}

export function redactSensitiveLogContext(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (key && SENSITIVE_LOG_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (typeof value === 'string') {
    return redactLogString(value)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return '[circular]'
  }
  seen.add(value)
  if (Array.isArray(value)) {
    const output = value.map((item) => redactSensitiveLogContext(item, undefined, seen))
    seen.delete(value)
    return output
  }
  const output: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    output[entryKey] = redactSensitiveLogContext(entryValue, entryKey, seen)
  }
  seen.delete(value)
  return output
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

    const payload = redactSensitiveLogContext({
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...context,
    })

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

export * from './metrics.js'
export * from './deployment.js'
