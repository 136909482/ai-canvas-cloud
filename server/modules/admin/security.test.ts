import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AdminAccessError,
  assertAdminAccess,
  hashAdminRequestIdentity,
  hasAdminPermission,
  redactAdminAuditPayload,
  safeTokenEqual,
} from '../../dist/modules/admin/security.js'

const activeAdmin = {
  id: 'admin-1',
  username: 'admin',
  role: 'auditor' as const,
  status: 'active' as const,
}

test('administrator access requires active status and matching role permission', () => {
  assert.doesNotThrow(() => assertAdminAccess(activeAdmin, 'audit.read'))
  assert.equal(hasAdminPermission('auditor', 'user.write'), false)
  assert.equal(hasAdminPermission('support', 'user.write'), true)
  assert.equal(hasAdminPermission('operator', 'site_config.write'), true)
  assert.equal(hasAdminPermission('super_admin', 'security.write'), true)
  assert.equal(hasAdminPermission('operator', 'security.write'), false)
  for (const role of ['super_admin', 'operator', 'support', 'auditor'] as const) {
    assert.equal(hasAdminPermission(role, 'dashboard.read'), true, `${role} dashboard.read`)
  }
  for (const role of ['super_admin', 'support'] as const) {
    assert.equal(hasAdminPermission(role, 'user.read'), true, `${role} user.read`)
    assert.equal(hasAdminPermission(role, 'user.write'), true, `${role} user.write`)
  }
  for (const role of ['operator', 'auditor'] as const) {
    assert.equal(hasAdminPermission(role, 'user.read'), false, `${role} user.read`)
    assert.equal(hasAdminPermission(role, 'user.write'), false, `${role} user.write`)
  }
  assert.throws(
    () => assertAdminAccess({ ...activeAdmin, status: 'banned' }, 'audit.read'),
    (error) => error instanceof AdminAccessError && error.code === 'ADMIN_ACCESS_DENIED',
  )
  assert.throws(
    () => assertAdminAccess(activeAdmin, 'security.write'),
    (error) => error instanceof AdminAccessError && error.code === 'ADMIN_ACCESS_DENIED',
  )
})

test('administrator audit redaction drops user content and removes every credential shape', () => {
  const redacted = redactAdminAuditPayload({
    status: 'active',
    apiKey: 'sk-should-never-appear',
    nested: {
      authorization: 'Bearer raw-token',
      endpoint: 'https://user:password@example.com/v1/generate?token=raw#fragment',
      prompt: 'private user prompt',
      providerResponse: { body: 'private provider response' },
      note: 'token=still-secret',
    },
  })
  const serialized = JSON.stringify(redacted)
  assert.equal(redacted.apiKey, '[REDACTED]')
  assert.equal((redacted.nested as Record<string, unknown>).endpoint, 'https://example.com')
  assert.equal('prompt' in (redacted.nested as Record<string, unknown>), false)
  assert.equal('providerResponse' in (redacted.nested as Record<string, unknown>), false)
  assert.doesNotMatch(serialized, /sk-should|raw-token|private user|private provider|still-secret/)
})

test('request identity hashes and token comparisons do not expose source values', () => {
  const hash = hashAdminRequestIdentity('192.0.2.20', 'pepper-value')
  assert.match(hash ?? '', /^[0-9a-f]{64}$/)
  assert.doesNotMatch(hash ?? '', /192\.0\.2\.20/)
  assert.equal(safeTokenEqual('same-token', 'same-token'), true)
  assert.equal(safeTokenEqual('same-token', 'other-token'), false)
})
