const REDACTED_VALUE = '[REDACTED]'

let sensitiveValues: string[] = []

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function setSensitiveValues(values: Iterable<string>) {
  sensitiveValues = [...new Set(
    [...values]
      .map((value) => value.trim())
      .filter((value) => value.length >= 4),
  )].sort((left, right) => right.length - left.length)
}

export function clearSensitiveValues() {
  sensitiveValues = []
}

export function redactSensitiveText(value: string) {
  let redacted = value

  for (const secret of sensitiveValues) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED_VALUE)
  }

  return redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED_VALUE}`)
    .replace(/\b(sk|key)-[a-z0-9._-]{8,}/gi, REDACTED_VALUE)
    .replace(
      /\b(api[_ -]?key|authorization|access[_ -]?token|token|secret)(["']?\s*[:=]\s*["']?)([^"'\s,;}]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}${REDACTED_VALUE}`,
    )
}

export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSensitiveText(value) as T
  }

  return value
}
