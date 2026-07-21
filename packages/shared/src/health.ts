export const dependencyFailureCategories = [
  'connection_refused',
  'timeout',
  'authentication_failed',
  'permission_denied',
  'bucket_unavailable',
  'unknown',
] as const

export type DependencyFailureCategory = typeof dependencyFailureCategories[number]

export interface MeasuredDependencyStatus {
  ok: boolean
  latencyMs: number
  error?: DependencyFailureCategory
}

const AUTHENTICATION_NAMES = new Set([
  'ExpiredToken',
  'InvalidAccessKeyId',
  'InvalidClientTokenId',
  'InvalidToken',
  'SignatureDoesNotMatch',
  'UnrecognizedClientException',
])
const PERMISSION_NAMES = new Set(['AccessDenied', 'Forbidden', 'Noperm'])
const BUCKET_NAMES = new Set(['NoSuchBucket', 'NotFound'])
const TIMEOUT_NAMES = new Set(['AbortError', 'TimeoutError'])

function errorRecords(error: unknown) {
  const records: Record<string, unknown>[] = []
  const pending = [error]
  const seen = new Set<unknown>()

  while (pending.length > 0 && records.length < 8) {
    const current = pending.shift()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    const record = current as Record<string, unknown>
    records.push(record)
    if (record.cause) pending.push(record.cause)
    if (Array.isArray(record.errors)) pending.push(...record.errors)
  }

  return records
}

function stringFields(records: Record<string, unknown>[]) {
  return records.flatMap((record) => ['name', 'code', 'Code', 'message']
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string'))
}

function statusCodes(records: Record<string, unknown>[]) {
  return records.flatMap((record) => {
    const metadata = record.$metadata
    const values = [
      record.statusCode,
      record.status,
      metadata && typeof metadata === 'object'
        ? (metadata as Record<string, unknown>).httpStatusCode
        : undefined,
    ]
    return values.filter((value): value is number => typeof value === 'number')
  })
}

export function classifyDependencyFailure(error: unknown): DependencyFailureCategory {
  const records = errorRecords(error)
  const fields = stringFields(records)
  const normalizedFields = fields.map((value) => value.toLowerCase())
  const statuses = statusCodes(records)

  if (fields.some((value) => value === 'ECONNREFUSED')) return 'connection_refused'
  if (fields.some((value) => TIMEOUT_NAMES.has(value) || value === 'ETIMEDOUT' || value === 'ESOCKETTIMEDOUT')
    || normalizedFields.some((value) => /\b(?:timed?\s*out|timeout)\b/.test(value))) {
    return 'timeout'
  }
  if (statuses.includes(401)
    || fields.some((value) => AUTHENTICATION_NAMES.has(value) || value === '28P01' || value === '28000')
    || normalizedFields.some((value) => /\b(?:wrongpass|noauth|authentication failed|password authentication failed)\b/.test(value))) {
    return 'authentication_failed'
  }
  if (statuses.includes(403)
    || fields.some((value) => PERMISSION_NAMES.has(value) || value === '42501')
    || normalizedFields.some((value) => /\b(?:access denied|permission denied|not authorized|noperm)\b/.test(value))) {
    return 'permission_denied'
  }
  if (statuses.includes(404)
    || fields.some((value) => BUCKET_NAMES.has(value))
    || normalizedFields.some((value) => /\b(?:no such bucket|bucket unavailable)\b/.test(value))) {
    return 'bucket_unavailable'
  }
  return 'unknown'
}

export async function measureDependencyCheck(
  check: () => Promise<void>,
  timeoutMs = 1_500,
): Promise<MeasuredDependencyStatus> {
  const startedAt = performance.now()
  let timeout: NodeJS.Timeout | undefined

  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error('Dependency health check timed out') as Error & { code: string }
          error.name = 'TimeoutError'
          error.code = 'HEALTH_CHECK_TIMEOUT'
          reject(error)
        }, timeoutMs)
        timeout.unref()
      }),
    ])
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt),
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: classifyDependencyFailure(error),
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
