import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudProviderSettingsApi } from './providerSettings.ts'

test('cloud provider settings client uses fixed provider configuration paths', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = []
  const api = createCloudProviderSettingsApi(async <TResponse>(path: string, options?: RequestInit) => {
    calls.push({ path, options })
    return {} as TResponse
  })

  await api.list()
  await api.update('openai', { websiteUrl: 'https://openai.com', apiKey: 'temporary-key', baseUrl: 'https://api.openai.com/v1' })
  await api.test('aliyun')
  await api.remove('openai')

  assert.deepEqual(calls, [
    { path: '/settings/providers', options: undefined },
    {
      path: '/settings/providers/openai',
      options: {
        method: 'PUT',
        body: JSON.stringify({ websiteUrl: 'https://openai.com', apiKey: 'temporary-key', baseUrl: 'https://api.openai.com/v1' }),
      },
    },
    { path: '/settings/providers/aliyun/test', options: { method: 'POST', body: '{}' } },
    { path: '/settings/providers/openai', options: { method: 'DELETE' } },
  ])
})
