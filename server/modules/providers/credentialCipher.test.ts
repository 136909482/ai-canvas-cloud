import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createProviderCredentialCipher,
  parseProviderCredentialKeyring,
} from '../../dist/modules/providers/credentialCipher.js'

const KEY_1 = Buffer.alloc(32, 1).toString('base64')
const KEY_2 = Buffer.alloc(32, 2).toString('base64')

test('provider credential cipher encrypts with random authenticated envelopes', () => {
  const cipher = createProviderCredentialCipher(parseProviderCredentialKeyring(`1:${KEY_1}`, 1))
  const context = { workspaceId: 'workspace-a', providerId: 'openai' }
  const first = cipher.encrypt('provider-secret-1234', context)
  const second = cipher.encrypt('provider-secret-1234', context)

  assert.equal(first.algorithm, 'aes-256-gcm')
  assert.equal(first.keyVersion, 1)
  assert.notEqual(first.ciphertext, second.ciphertext)
  assert.equal(JSON.stringify(first).includes('provider-secret-1234'), false)
  assert.equal(cipher.decrypt(first, context), 'provider-secret-1234')
  assert.throws(() => cipher.decrypt(first, { ...context, workspaceId: 'workspace-b' }))
  assert.throws(() => cipher.decrypt(first, { ...context, providerId: 'aliyun' }))
})

test('provider credential keyring decrypts old versions during rotation', () => {
  const oldCipher = createProviderCredentialCipher(parseProviderCredentialKeyring(`1:${KEY_1}`, 1))
  const rotatedCipher = createProviderCredentialCipher(parseProviderCredentialKeyring(`1:${KEY_1},2:${KEY_2}`, 2))
  const context = { workspaceId: 'workspace-a', providerId: 'openai' }
  const oldEnvelope = oldCipher.encrypt('old-provider-secret', context)
  const newEnvelope = rotatedCipher.encrypt('new-provider-secret', context)

  assert.equal(rotatedCipher.decrypt(oldEnvelope, context), 'old-provider-secret')
  assert.equal(newEnvelope.keyVersion, 2)
  assert.throws(() => oldCipher.decrypt(newEnvelope, context))
  assert.throws(() => parseProviderCredentialKeyring('1:not-base64', 1))
  assert.throws(() => parseProviderCredentialKeyring(`1:${KEY_1}`, 2))
})
