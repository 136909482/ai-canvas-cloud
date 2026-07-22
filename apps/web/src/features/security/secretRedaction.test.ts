import {
  clearSensitiveValues,
  redactSensitiveText,
  setSensitiveValues,
} from './secretRedaction.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function runSecretRedactionTests() {
  setSensitiveValues(['device-only-secret'])

  const redacted = redactSensitiveText(
    'Authorization: Bearer abcdefgh API_KEY=device-only-secret token=visible-token sk-example123456',
  )

  assert(!redacted.includes('device-only-secret'), 'registered vault secrets should be removed')
  assert(!redacted.includes('abcdefgh'), 'bearer credentials should be removed')
  assert(!redacted.includes('visible-token'), 'labeled tokens should be removed')
  assert(!redacted.includes('sk-example123456'), 'common API key shapes should be removed')
  assert(redacted.includes('[REDACTED]'), 'redaction should leave a stable marker')

  clearSensitiveValues()
}

runSecretRedactionTests()
