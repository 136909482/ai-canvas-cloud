import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCloudProviderDefinition,
  isProviderGenerationTaskEnabled,
  normalizeProviderBaseUrl,
  isAllowedProviderResultUrl,
  resolveProviderEndpoint,
  resolveProviderTaskEndpoint,
  resolveProviderTestEndpoint,
} from '../../dist/modules/providers/registry.js'

test('provider registry accepts configured public HTTPS base URLs', () => {
  assert.equal(normalizeProviderBaseUrl('openai'), 'https://api.openai.com')
  assert.equal(normalizeProviderBaseUrl('openai', 'https://api.openai.com/'), 'https://api.openai.com')
  assert.equal(
    normalizeProviderBaseUrl('aliyun', 'https://dashscope.aliyuncs.com/compatible-mode/v1/'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  )
  assert.equal(
    resolveProviderEndpoint('aliyun', 'image_async_submission'),
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
  )
  assert.equal(
    resolveProviderEndpoint('aliyun', 'video_async_submission'),
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
  )
  assert.equal(
    resolveProviderTaskEndpoint('aliyun', 'task_abc-123'),
    'https://dashscope.aliyuncs.com/api/v1/tasks/task_abc-123',
  )
  assert.throws(() => resolveProviderTaskEndpoint('aliyun', '../unsafe'))
  assert.throws(() => normalizeProviderBaseUrl('openai', 'http://api.openai.com'))
  assert.throws(() => normalizeProviderBaseUrl('openai', 'https://user:pass@api.openai.com'))
  assert.throws(() => normalizeProviderBaseUrl('openai', 'https://api.openai.com:8443'))
  assert.equal(normalizeProviderBaseUrl('openai', 'https://api.openai.com/v1'), 'https://api.openai.com/v1')
  assert.equal(normalizeProviderBaseUrl('custom', 'https://provider.example/v1/'), 'https://provider.example/v1')
  assert.throws(() => normalizeProviderBaseUrl('custom', 'https://127.0.0.1/v1'))
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
  assert.equal(resolveProviderTestEndpoint('openai'), 'https://api.openai.com/v1/models')
  assert.equal(getCloudProviderDefinition('openai')?.providerType, 'openai_compatible')
  assert.equal(isAllowedProviderResultUrl('openai', 'https://api.openai.com/result.png'), true)
  assert.equal(isAllowedProviderResultUrl('openai', 'http://api.openai.com/result.png'), false)
  assert.equal(isAllowedProviderResultUrl('openai', 'https://api.openai.com.evil.example/result.png'), false)
  assert.equal(isAllowedProviderResultUrl('openai', 'https://127.0.0.1/result.png'), false)
  assert.equal(isProviderGenerationTaskEnabled({ providerType: 'openai_compatible', kind: 'image', model: 'custom-image' }), true)
  assert.equal(isProviderGenerationTaskEnabled({ providerType: 'openai_compatible', kind: 'video', model: 'custom-video' }), false)
  assert.equal(isProviderGenerationTaskEnabled({ providerType: 'aliyun_dashscope', kind: 'image', model: 'wanx2.1-t2i-turbo' }), true)
  assert.equal(isProviderGenerationTaskEnabled({ providerType: 'aliyun_dashscope', kind: 'video', model: 'wan2.7-t2v' }), true)
  assert.equal(isProviderGenerationTaskEnabled({ providerType: 'aliyun_dashscope', kind: 'image', model: 'wanx' }), false)
})
