import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeProviderBaseUrl,
  resolveProviderEndpoint,
} from '../../dist/modules/providers/registry.js'

test('provider registry accepts only fixed HTTPS base URLs', () => {
  assert.equal(normalizeProviderBaseUrl('openai'), 'https://api.openai.com')
  assert.equal(normalizeProviderBaseUrl('openai', 'https://api.openai.com/'), 'https://api.openai.com')
  assert.equal(
    normalizeProviderBaseUrl('aliyun', 'https://dashscope.aliyuncs.com/compatible-mode/v1/'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  )
  assert.throws(() => normalizeProviderBaseUrl('openai', 'http://api.openai.com'))
  assert.throws(() => normalizeProviderBaseUrl('openai', 'https://api.openai.com.evil.example'))
  assert.throws(() => normalizeProviderBaseUrl('openai', 'https://user:pass@api.openai.com'))
  assert.throws(() => normalizeProviderBaseUrl('openai', 'https://api.openai.com:8443'))
  assert.throws(() => normalizeProviderBaseUrl('openai', 'https://api.openai.com/v1'))
  assert.throws(() => normalizeProviderBaseUrl('custom', 'https://provider.example'))
})

test('provider endpoint resolution uses registry-owned paths', () => {
  assert.equal(
    resolveProviderEndpoint('openai', 'image_generation'),
    'https://api.openai.com/v1/images/generations',
  )
  assert.equal(
    resolveProviderEndpoint('aliyun', 'chat'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  )
  assert.throws(() => resolveProviderEndpoint('aliyun', 'image_edit'))
})
