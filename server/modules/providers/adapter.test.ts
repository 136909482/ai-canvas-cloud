import assert from 'node:assert/strict'
import test from 'node:test'
import { createMetricsRegistry } from '@ai-canvas-cloud/shared'
import {
  createProviderAdapter,
  ProviderGatewayError,
} from '../../dist/modules/providers/adapter.js'

const API_KEY = 'provider-secret-value'

function createLoggerEntries() {
  const entries: Array<{ message: string; context: Record<string, unknown> | undefined }> = []
  return {
    entries,
    logger: {
      debug() {},
      info(message: string, context?: Record<string, unknown>) { entries.push({ message, context }) },
      warn(message: string, context?: Record<string, unknown>) { entries.push({ message, context }) },
      error() {},
    },
  }
}

test('provider adapter uses only registry-owned endpoints and never logs credentials or response bodies', async () => {
  let requestedUrl = ''
  let request: RequestInit | undefined
  const { entries, logger } = createLoggerEntries()
  const adapter = createProviderAdapter({
    logger,
    fetch: async (url, init) => {
      requestedUrl = url
      request = init
      return new Response(`provider body ${API_KEY}`, { status: 200 })
    },
  })

  await adapter.testConnection({ providerId: 'openai', apiKey: API_KEY })
  assert.equal(requestedUrl, 'https://api.openai.com/v1/models')
  assert.equal(request?.redirect, 'error')
  assert.equal((request?.headers as Record<string, string>).authorization, `Bearer ${API_KEY}`)
  assert.equal(JSON.stringify(entries).includes(API_KEY), false)
  assert.equal(JSON.stringify(entries).includes('provider body'), false)
})

test('provider adapter classifies redirect, timeout, upstream and oversized responses without reading bodies into logs', async () => {
  const scenarios: Array<{
    name: string
    fetch: Parameters<typeof createProviderAdapter>[0]['fetch']
    category: ProviderGatewayError['category']
    retryable: boolean
  }> = [
    {
      name: 'redirect',
      fetch: async () => { throw new TypeError('fetch failed: redirect mode is error') },
      category: 'redirect', retryable: false,
    },
    {
      name: 'timeout',
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
      category: 'timeout', retryable: true,
    },
    {
      name: 'upstream',
      fetch: async () => new Response('upstream error', { status: 503 }),
      category: 'upstream', retryable: true,
    },
    {
      name: 'oversized',
      fetch: async () => new Response('x'.repeat(32), { status: 200 }),
      category: 'response_too_large', retryable: false,
    },
  ]

  for (const scenario of scenarios) {
    const { entries, logger } = createLoggerEntries()
    const adapter = createProviderAdapter({
      logger,
      fetch: scenario.fetch,
      timeoutMs: 5,
      maxResponseBytes: 16,
    })
    await assert.rejects(
      () => adapter.testConnection({ providerId: 'openai', apiKey: API_KEY }),
      (error: unknown) => error instanceof ProviderGatewayError
        && error.category === scenario.category
        && error.retryable === scenario.retryable,
      scenario.name,
    )
    assert.equal(JSON.stringify(entries).includes(API_KEY), false)
    assert.equal(JSON.stringify(entries).includes('upstream error'), false)
  }
})

test('provider adapter sends a constrained OpenAI image request and parses base64 image bytes', async () => {
  let requestedUrl = ''
  let request: RequestInit | undefined
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
  const adapter = createProviderAdapter({
    fetch: async (_url, init) => {
      requestedUrl = _url
      request = init
      return new Response(JSON.stringify({
        data: [{ b64_json: png }],
        usage: { total_tokens: 42, ignored: 'not-a-counter' },
      }), { status: 200 })
    },
  })
  const result = await adapter.generateImage({
    providerId: 'openai',
    apiKey: API_KEY,
    model: 'gpt-image-2',
    parameters: { prompt: 'draw a circle', resolution: '1024x1024', quality: 'high', outputFormat: 'png' },
  })

  assert.equal(requestedUrl, 'https://api.openai.com/v1/images/generations')
  assert.equal(request?.redirect, 'error')
  assert.equal((request?.headers as Record<string, string>).authorization, `Bearer ${API_KEY}`)
  assert.deepEqual(JSON.parse(String(request?.body)), {
    model: 'gpt-image-2', prompt: 'draw a circle', size: '1024x1024', quality: 'high', output_format: 'png',
  })
  assert.equal(result.mimeType, 'image/png')
  assert.equal(result.imageBytes.byteLength, 8)
  assert.deepEqual(result.usage, { total_tokens: 42 })
})

test('provider adapter sends OpenAI image edits as a fixed multipart request from private bytes', async () => {
  let requestedUrl = ''
  let request: RequestInit | undefined
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const adapter = createProviderAdapter({
    fetch: async (url, init) => {
      requestedUrl = url
      request = init
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }],
      }), { status: 200 })
    },
  })

  const result = await adapter.editImage({
    providerId: 'openai',
    apiKey: API_KEY,
    model: 'gpt-image-2',
    parameters: { prompt: 'change the background', outputFormat: 'webp' },
    image: pngBytes,
    mimeType: 'image/png',
  })

  assert.equal(requestedUrl, 'https://api.openai.com/v1/images/edits')
  assert.equal(request?.redirect, 'error')
  assert.equal((request?.headers as Record<string, string>).authorization, `Bearer ${API_KEY}`)
  assert(request?.body instanceof FormData)
  assert.equal(request.body.get('model'), 'gpt-image-2')
  assert.equal(request.body.get('prompt'), 'change the background')
  assert.equal(request.body.get('output_format'), 'webp')
  const image = request.body.get('image')
  assert(image instanceof Blob)
  assert.equal(image.type, 'image/png')
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), pngBytes)
  assert.equal(result.mimeType, 'image/webp')
  assert.deepEqual(result.imageBytes, pngBytes)
})

test('provider adapter submits and polls the fixed Aliyun async image protocol', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const adapter = createProviderAdapter({
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (init.method === 'POST') {
        return new Response(JSON.stringify({ output: { task_id: 'task_abc-123' } }), { status: 200 })
      }
      return new Response(JSON.stringify({
        output: { task_status: 'SUCCEEDED', results: [{ url: 'https://dashscope.aliyuncs.com/result.png' }] },
      }), { status: 200 })
    },
  })

  assert.deepEqual(await adapter.submitAliyunImageTask({
    providerId: 'aliyun', apiKey: API_KEY, model: 'wanx2.1-t2i-turbo',
    parameters: { prompt: 'paint a valley', resolution: '1024x768', negativePrompt: 'text' },
  }), { remoteTaskId: 'task_abc-123' })
  assert.deepEqual(await adapter.pollAliyunImageTask({
    providerId: 'aliyun', apiKey: API_KEY, remoteTaskId: 'task_abc-123',
  }), { status: 'succeeded', resultUrl: 'https://dashscope.aliyuncs.com/result.png' })

  assert.equal(requests[0]?.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis')
  assert.equal((requests[0]?.init.headers as Record<string, string>).authorization, `Bearer ${API_KEY}`)
  assert.equal((requests[0]?.init.headers as Record<string, string>)['x-dashscope-async'], 'enable')
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    model: 'wanx2.1-t2i-turbo', input: { prompt: 'paint a valley' },
    parameters: { size: '1024*768', watermark: false, prompt_extend: true, negative_prompt: 'text' },
  })
  assert.equal(requests[1]?.url, 'https://dashscope.aliyuncs.com/api/v1/tasks/task_abc-123')
  assert.equal(requests[1]?.init.method, 'GET')
})

test('Aliyun async image adapter keeps rate limits and timeouts retryable without fetching after cancellation', async () => {
  const rateLimited = createProviderAdapter({ fetch: async () => new Response('', { status: 429 }) })
  await assert.rejects(
    () => rateLimited.submitAliyunImageTask({
      providerId: 'aliyun', apiKey: API_KEY, model: 'wanx2.1-t2i-turbo', parameters: { prompt: 'draw' },
    }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'upstream' && error.retryable,
  )
  const timeout = createProviderAdapter({
    imageGenerationTimeoutMs: 5,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
  })
  await assert.rejects(
    () => timeout.pollAliyunImageTask({ providerId: 'aliyun', apiKey: API_KEY, remoteTaskId: 'task-123' }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'timeout' && error.retryable,
  )
  const controller = new AbortController()
  controller.abort()
  let fetchCalls = 0
  const canceled = createProviderAdapter({ fetch: async () => { fetchCalls += 1; return new Response('', { status: 200 }) } })
  await assert.rejects(
    () => canceled.submitAliyunImageTask({
      providerId: 'aliyun', apiKey: API_KEY, model: 'wanx2.1-t2i-turbo', parameters: { prompt: 'draw' }, signal: controller.signal,
    }),
    (error: unknown) => error instanceof ProviderGatewayError && error.retryable,
  )
  assert.equal(fetchCalls, 0)
})

test('provider adapter submits and polls the fixed Aliyun async video protocol', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const adapter = createProviderAdapter({
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (init.method === 'POST') {
        return new Response(JSON.stringify({ output: { task_id: 'video-123' } }), { status: 200 })
      }
      return new Response(JSON.stringify({
        output: { task_status: 'SUCCEEDED', video_url: 'https://dashscope.aliyuncs.com/result.mp4' },
      }), { status: 200 })
    },
  })

  assert.deepEqual(await adapter.submitAliyunVideoTask({
    providerId: 'aliyun', apiKey: API_KEY, model: 'wan2.7-t2v',
    parameters: { prompt: 'camera moves over a lake', resolution: '1080p', ratio: '9:16', duration: '10s' },
  }), { remoteTaskId: 'video-123' })
  assert.deepEqual(await adapter.pollAliyunVideoTask({
    providerId: 'aliyun', apiKey: API_KEY, remoteTaskId: 'video-123',
  }), { status: 'succeeded', resultUrl: 'https://dashscope.aliyuncs.com/result.mp4' })
  assert.equal(requests[0]?.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis')
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    model: 'wan2.7-t2v', input: { prompt: 'camera moves over a lake' },
    parameters: { resolution: '1080P', ratio: '9:16', duration: 10, prompt_extend: true, watermark: false },
  })
  assert.equal(requests[1]?.url, 'https://dashscope.aliyuncs.com/api/v1/tasks/video-123')
  await assert.rejects(
    () => adapter.submitAliyunVideoTask({
      providerId: 'aliyun', apiKey: API_KEY, model: 'wan2.7-t2v',
      parameters: { prompt: 'bad', resolution: '480P', ratio: '1:1', duration: 3 },
    }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'rejected' && !error.retryable,
  )
})

test('Aliyun async video adapter keeps rate limits and timeouts retryable and does not fetch after cancellation', async () => {
  const rateLimited = createProviderAdapter({ fetch: async () => new Response('', { status: 429 }) })
  const videoInput = {
    providerId: 'aliyun' as const, apiKey: API_KEY, model: 'wan2.7-t2v',
    parameters: { prompt: 'camera moves over a lake', resolution: '720P', ratio: '16:9', duration: 5 },
  }
  await assert.rejects(
    () => rateLimited.submitAliyunVideoTask(videoInput),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'upstream' && error.retryable,
  )
  const timeout = createProviderAdapter({
    imageGenerationTimeoutMs: 5,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
  })
  await assert.rejects(
    () => timeout.pollAliyunVideoTask({ providerId: 'aliyun', apiKey: API_KEY, remoteTaskId: 'video-123' }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'timeout' && error.retryable,
  )
  const controller = new AbortController()
  controller.abort()
  let fetchCalls = 0
  const canceled = createProviderAdapter({ fetch: async () => { fetchCalls += 1; return new Response('', { status: 200 }) } })
  await assert.rejects(
    () => canceled.submitAliyunVideoTask({ ...videoInput, signal: controller.signal }),
    (error: unknown) => error instanceof ProviderGatewayError && error.retryable,
  )
  assert.equal(fetchCalls, 0)
})

test('provider adapter rejects unsupported image inputs and classifies rate limits', async () => {
  const rateLimited = createProviderAdapter({ fetch: async () => new Response('', { status: 429 }) })
  await assert.rejects(
    () => rateLimited.generateImage({ providerId: 'openai', apiKey: API_KEY, model: 'gpt-image-2', parameters: { prompt: 'draw' } }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'upstream' && error.retryable,
  )
  await assert.rejects(
    () => rateLimited.generateImage({ providerId: 'aliyun', apiKey: API_KEY, model: 'wanx', parameters: { prompt: 'draw' } }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'rejected' && !error.retryable,
  )
  await assert.rejects(
    () => rateLimited.generateImage({ providerId: 'openai', apiKey: API_KEY, model: 'gpt-image-2', parameters: { prompt: '' } }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'rejected' && !error.retryable,
  )
  await assert.rejects(
    () => rateLimited.generateImage({ providerId: 'openai', apiKey: API_KEY, model: 'other-image-model', parameters: { prompt: 'draw' } }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'rejected' && !error.retryable,
  )
  await assert.rejects(
    () => rateLimited.editImage({
      providerId: 'openai', apiKey: API_KEY, model: 'gpt-image-2', parameters: { prompt: 'draw' },
      image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png',
    }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'upstream' && error.retryable,
  )
  await assert.rejects(
    () => rateLimited.editImage({
      providerId: 'openai', apiKey: API_KEY, model: 'gpt-image-2', parameters: { prompt: '' },
      image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png',
    }),
    (error: unknown) => error instanceof ProviderGatewayError && error.category === 'rejected' && !error.retryable,
  )
})

test('provider adapter records low-cardinality request latency metrics', async () => {
  const metrics = createMetricsRegistry()
  const adapter = createProviderAdapter({
    metrics,
    fetch: async () => new Response('{}', { status: 200 }),
  })
  await adapter.testConnection({ providerId: 'openai', apiKey: 'secret-value' })

  const observation = metrics.snapshot().histograms.find((item) => item.name === 'ai_canvas_provider_request_duration_seconds')
  assert.equal(observation?.labels.provider, 'openai')
  assert.equal(observation?.labels.operation, 'connection_test')
  assert.equal(observation?.labels.outcome, 'success')
  assert.equal('apiKey' in (observation?.labels ?? {}), false)
})
