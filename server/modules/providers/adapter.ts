import { createJsonLogger, type Logger, type MetricsRegistry } from '@ai-canvas-cloud/shared'
import { getCloudProviderDefinition, resolveProviderTaskEndpoint, resolveProviderTestEndpoint } from './registry.js'
import { resolveProviderEndpoint, type CloudProviderType } from './registry.js'

export const PROVIDER_CONNECTION_TEST_TIMEOUT_MS = 10_000
export const PROVIDER_CONNECTION_TEST_MAX_RESPONSE_BYTES = 64 * 1024
export const PROVIDER_IMAGE_GENERATION_TIMEOUT_MS = 120_000
export const PROVIDER_IMAGE_GENERATION_MAX_RESPONSE_BYTES = 70 * 1024 * 1024

export type ProviderExecutionMode = 'sync' | 'async'
export type ProviderGatewayErrorCategory =
  | 'authentication'
  | 'rejected'
  | 'redirect'
  | 'response_too_large'
  | 'timeout'
  | 'network'
  | 'upstream'

export interface ProviderAdapterSubmission {
  mode: ProviderExecutionMode
  providerId: string
  model: string
  parameters: Record<string, unknown>
}

export interface ProviderAdapter {
  supportsIdempotentSubmission: (providerId: string) => boolean
  testConnection: (input: {
    providerId: string
    providerType?: CloudProviderType
    baseUrl?: string
    apiKey: string
  }) => Promise<void>
  generateImage: (input: {
    providerId: string
    providerType?: CloudProviderType
    baseUrl?: string
    apiKey: string
    model: string
    parameters: Record<string, unknown>
    signal?: AbortSignal
  }) => Promise<{
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    imageBytes: Uint8Array
    usage: Record<string, number>
  }>
  editImage: (input: {
    providerId: string
    providerType?: CloudProviderType
    baseUrl?: string
    apiKey: string
    model: string
    parameters: Record<string, unknown>
    image: Uint8Array
    mimeType: string
    signal?: AbortSignal
  }) => ReturnType<ProviderAdapter['generateImage']>
  submitAliyunImageTask: (input: {
    providerId: string
    providerType?: CloudProviderType
    baseUrl?: string
    apiKey: string
    model: string
    parameters: Record<string, unknown>
    signal?: AbortSignal
  }) => Promise<{ remoteTaskId: string }>
  pollAliyunImageTask: (input: {
    providerId: string
    providerType?: CloudProviderType
    baseUrl?: string
    apiKey: string
    remoteTaskId: string
    signal?: AbortSignal
  }) => Promise<
    | { status: 'pending' }
    | { status: 'succeeded'; resultUrl: string }
    | { status: 'failed' }
  >
  submitAliyunVideoTask: (input: {
    providerId: string
    providerType?: CloudProviderType
    baseUrl?: string
    apiKey: string
    model: string
    parameters: Record<string, unknown>
    signal?: AbortSignal
  }) => Promise<{ remoteTaskId: string }>
  pollAliyunVideoTask: (input: {
    providerId: string
    providerType?: CloudProviderType
    baseUrl?: string
    apiKey: string
    remoteTaskId: string
    signal?: AbortSignal
  }) => Promise<
    | { status: 'pending' }
    | { status: 'succeeded'; resultUrl: string }
    | { status: 'failed' }
  >
}

export class ProviderGatewayError extends Error {
  constructor(
    readonly category: ProviderGatewayErrorCategory,
    readonly retryable: boolean,
  ) {
    super(`Provider gateway ${category}`)
    this.name = 'ProviderGatewayError'
  }
}

type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>

function classifyResponse(statusCode: number): ProviderGatewayError {
  if (statusCode === 401 || statusCode === 403) {
    return new ProviderGatewayError('authentication', false)
  }
  if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
    return new ProviderGatewayError('upstream', true)
  }
  return new ProviderGatewayError('rejected', false)
}

function classifyFetchFailure(error: unknown, timedOut: boolean): ProviderGatewayError {
  if (timedOut) {
    return new ProviderGatewayError('timeout', true)
  }
  const cause = error instanceof Error && 'cause' in error
    ? (error as Error & { cause?: unknown }).cause
    : undefined
  const message = [
    error instanceof Error ? error.message : '',
    cause instanceof Error ? cause.message : '',
  ].join(' ').toLowerCase()
  if (message.includes('redirect')) {
    return new ProviderGatewayError('redirect', false)
  }
  return new ProviderGatewayError('network', true)
}

function resolveAdapterProvider(input: { providerId: string; providerType?: CloudProviderType; baseUrl?: string }) {
  const legacy = getCloudProviderDefinition(input.providerId)
  const providerType = input.providerType ?? legacy?.providerType
  const baseUrl = input.baseUrl ?? legacy?.defaultBaseUrl
  if (!providerType || !baseUrl) throw new ProviderGatewayError('rejected', false)
  return { providerType, baseUrl }
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController) {
  if (!signal) {
    return () => undefined
  }
  const abort = () => controller.abort()
  if (signal.aborted) {
    controller.abort()
  } else {
    signal.addEventListener('abort', abort, { once: true })
  }
  return () => signal.removeEventListener('abort', abort)
}

async function consumeLimitedResponse(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > maximumBytes) {
    throw new ProviderGatewayError('response_too_large', false)
  }
  if (!response.body) {
    return
  }

  const reader = response.body.getReader()
  let receivedBytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        return
      }
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > maximumBytes) {
        throw new ProviderGatewayError('response_too_large', false)
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function requireImagePrompt(parameters: Record<string, unknown>) {
  const prompt = parameters.prompt
  if (typeof prompt !== 'string' || prompt.trim().length < 1 || prompt.length > 12_000) {
    throw new ProviderGatewayError('rejected', false)
  }
  return prompt.trim()
}

function optionalEnum(parameters: Record<string, unknown>, key: string, allowed: readonly string[]) {
  const value = parameters[key]
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ProviderGatewayError('rejected', false)
  }
  return value
}

function optionalImageSize(parameters: Record<string, unknown>) {
  const value = parameters.size ?? parameters.resolution
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || !/^\d{2,4}x\d{2,4}$/i.test(value)) {
    throw new ProviderGatewayError('rejected', false)
  }
  return value.toLowerCase()
}

function optionalAliyunImageSize(parameters: Record<string, unknown>) {
  const value = parameters.size ?? parameters.resolution
  if (value === undefined || value === null) {
    return '1024*1024'
  }
  if (typeof value !== 'string' || !/^\d{2,4}[x*]\d{2,4}$/i.test(value)) {
    throw new ProviderGatewayError('rejected', false)
  }
  return value.toLowerCase().replace('x', '*')
}

function optionalNegativePrompt(parameters: Record<string, unknown>) {
  const value = parameters.negativePrompt ?? parameters.negative_prompt
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.length > 4_000) {
    throw new ProviderGatewayError('rejected', false)
  }
  return value.trim() || undefined
}

function requireAliyunVideoResolution(parameters: Record<string, unknown>) {
  const value = parameters.resolution
  if (typeof value !== 'string' || !['720P', '1080P'].includes(value.toUpperCase())) {
    throw new ProviderGatewayError('rejected', false)
  }
  return value.toUpperCase()
}

function requireAliyunVideoRatio(parameters: Record<string, unknown>) {
  const value = parameters.ratio
  if (value !== '16:9' && value !== '9:16') {
    throw new ProviderGatewayError('rejected', false)
  }
  return value
}

function requireAliyunVideoDuration(parameters: Record<string, unknown>) {
  const value = parameters.duration
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^(5|10)s?$/.test(value.trim())
      ? Number.parseInt(value, 10)
      : Number.NaN
  if (parsed !== 5 && parsed !== 10) {
    throw new ProviderGatewayError('rejected', false)
  }
  return parsed
}

async function readLimitedJson(response: Response, maximumBytes: number) {
  const contentLength = response.headers.get('content-length')
  if (contentLength && (!Number.isSafeInteger(Number(contentLength)) || Number(contentLength) > maximumBytes)) {
    throw new ProviderGatewayError('response_too_large', false)
  }
  if (!response.body) {
    throw new ProviderGatewayError('rejected', false)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > maximumBytes) {
        throw new ProviderGatewayError('response_too_large', false)
      }
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new ProviderGatewayError('rejected', false)
  }
}

function parseImageGenerationResponse(value: unknown, outputFormat: 'png' | 'jpeg' | 'webp') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('data' in value) || !Array.isArray(value.data)) {
    throw new ProviderGatewayError('rejected', false)
  }
  const first = value.data[0]
  if (!first || typeof first !== 'object' || Array.isArray(first) || !('b64_json' in first) || typeof first.b64_json !== 'string') {
    throw new ProviderGatewayError('rejected', false)
  }
  const encoded = first.b64_json
  if (!encoded || encoded.length > PROVIDER_IMAGE_GENERATION_MAX_RESPONSE_BYTES * 2 || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
    throw new ProviderGatewayError('rejected', false)
  }
  const imageBytes = Buffer.from(encoded, 'base64')
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > 50 * 1024 * 1024) {
    throw new ProviderGatewayError('response_too_large', false)
  }
  const usageSource = 'usage' in value && value.usage && typeof value.usage === 'object' && !Array.isArray(value.usage)
    ? value.usage as Record<string, unknown>
    : {}
  const usage = Object.fromEntries(Object.entries(usageSource).flatMap(([key, amount]) =>
    typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? [[key, amount]] : [],
  ))
  return {
    mimeType: `image/${outputFormat}` as const,
    imageBytes: new Uint8Array(imageBytes),
    usage,
  }
}

function requireAliyunRemoteTaskId(value: unknown) {
  const output = value && typeof value === 'object' && !Array.isArray(value) && 'output' in value
    && value.output && typeof value.output === 'object' && !Array.isArray(value.output)
    ? value.output as Record<string, unknown>
    : null
  const remoteTaskId = output?.task_id
  if (typeof remoteTaskId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(remoteTaskId)) {
    throw new ProviderGatewayError('rejected', false)
  }
  return remoteTaskId
}

function parseAliyunImageTask(value: unknown): Awaited<ReturnType<ProviderAdapter['pollAliyunImageTask']>> {
  const output = value && typeof value === 'object' && !Array.isArray(value) && 'output' in value
    && value.output && typeof value.output === 'object' && !Array.isArray(value.output)
    ? value.output as Record<string, unknown>
    : null
  if (!output) {
    throw new ProviderGatewayError('rejected', false)
  }
  const status = output.task_status
  if (typeof status !== 'string') {
    throw new ProviderGatewayError('rejected', false)
  }
  if (['PENDING', 'PENDING_QUEUE', 'QUEUED', 'RUNNING', 'PROCESSING', 'SUBMITTED', 'WAITING'].includes(status.toUpperCase())) {
    return { status: 'pending' }
  }
  if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status.toUpperCase())) {
    return { status: 'failed' }
  }
  if (status.toUpperCase() !== 'SUCCEEDED') {
    throw new ProviderGatewayError('rejected', false)
  }
  const results = output.results
  const first = Array.isArray(results) ? results[0] : null
  const resultUrl = first && typeof first === 'object' && !Array.isArray(first) && 'url' in first ? first.url : null
  if (typeof resultUrl !== 'string') {
    throw new ProviderGatewayError('rejected', false)
  }
  return { status: 'succeeded', resultUrl }
}

function parseAliyunVideoTask(value: unknown): Awaited<ReturnType<ProviderAdapter['pollAliyunVideoTask']>> {
  const output = value && typeof value === 'object' && !Array.isArray(value) && 'output' in value
    && value.output && typeof value.output === 'object' && !Array.isArray(value.output)
    ? value.output as Record<string, unknown>
    : null
  if (!output || typeof output.task_status !== 'string') {
    throw new ProviderGatewayError('rejected', false)
  }
  const status = output.task_status.toUpperCase()
  if (['PENDING', 'PENDING_QUEUE', 'QUEUED', 'RUNNING', 'PROCESSING', 'SUBMITTED', 'WAITING'].includes(status)) {
    return { status: 'pending' }
  }
  if (['FAILED', 'FAILURE', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status)) {
    return { status: 'failed' }
  }
  if (status !== 'SUCCEEDED' || typeof output.video_url !== 'string') {
    throw new ProviderGatewayError('rejected', false)
  }
  return { status: 'succeeded', resultUrl: output.video_url }
}

export function createProviderAdapter(options: {
  fetch?: ProviderFetch
  logger?: Logger
  timeoutMs?: number
  maxResponseBytes?: number
  imageGenerationTimeoutMs?: number
  imageGenerationMaxResponseBytes?: number
  metrics?: MetricsRegistry
} = {}): ProviderAdapter {
  const providerFetch = options.fetch ?? ((url, init) => fetch(url, init))
  const logger = options.logger ?? createJsonLogger({ service: 'provider-gateway' })
  const timeoutMs = options.timeoutMs ?? PROVIDER_CONNECTION_TEST_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? PROVIDER_CONNECTION_TEST_MAX_RESPONSE_BYTES
  const imageGenerationTimeoutMs = options.imageGenerationTimeoutMs ?? PROVIDER_IMAGE_GENERATION_TIMEOUT_MS
  const imageGenerationMaxResponseBytes = options.imageGenerationMaxResponseBytes ?? PROVIDER_IMAGE_GENERATION_MAX_RESPONSE_BYTES

  const adapter: ProviderAdapter = {
    supportsIdempotentSubmission(providerId) {
      return Boolean(getCloudProviderDefinition(providerId)) && false
    },

    async testConnection(input) {
      const provider = resolveAdapterProvider(input)
      const endpoint = resolveProviderTestEndpoint(provider.providerType, provider.baseUrl)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      const startedAt = Date.now()

      try {
        const response = await providerFetch(endpoint, {
          method: 'GET',
          headers: { authorization: `Bearer ${input.apiKey}` },
          redirect: 'error',
          signal: controller.signal,
        })
        await consumeLimitedResponse(response, maxResponseBytes)
        if (!response.ok) {
          throw classifyResponse(response.status)
        }
        logger.info('provider.connection_test.completed', {
          providerId: input.providerId,
          statusCode: response.status,
          elapsedMs: Date.now() - startedAt,
        })
      } catch (error) {
        const gatewayError = error instanceof ProviderGatewayError
          ? error
          : classifyFetchFailure(error, controller.signal.aborted)
        logger.warn('provider.connection_test.failed', {
          providerId: input.providerId,
          category: gatewayError.category,
          retryable: gatewayError.retryable,
          elapsedMs: Date.now() - startedAt,
        })
        throw gatewayError
      } finally {
        clearTimeout(timeout)
      }
    },

    async generateImage(input) {
      const provider = resolveAdapterProvider(input)
      if (provider.providerType !== 'openai_compatible') {
        throw new ProviderGatewayError('rejected', false)
      }
      const prompt = requireImagePrompt(input.parameters)
      const size = optionalImageSize(input.parameters)
      const quality = optionalEnum(input.parameters, 'quality', ['low', 'medium', 'high', 'auto'])
      const outputFormatValue = optionalEnum(input.parameters, 'outputFormat', ['png', 'jpeg', 'webp'])
        ?? optionalEnum(input.parameters, 'output_format', ['png', 'jpeg', 'webp'])
        ?? 'png'
      const outputFormat = outputFormatValue as 'png' | 'jpeg' | 'webp'
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), imageGenerationTimeoutMs)
      const unlinkAbortSignal = linkAbortSignal(input.signal, controller)
      try {
        if (controller.signal.aborted) throw new ProviderGatewayError('network', true)
        const response = await providerFetch(resolveProviderEndpoint(provider.providerType, provider.baseUrl, 'image_generation'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: input.model,
            prompt,
            ...(size ? { size } : {}),
            ...(quality ? { quality } : {}),
            output_format: outputFormat,
          }),
          redirect: 'error',
          signal: controller.signal,
        })
        if (!response.ok) {
          await consumeLimitedResponse(response, PROVIDER_CONNECTION_TEST_MAX_RESPONSE_BYTES)
          throw classifyResponse(response.status)
        }
        return parseImageGenerationResponse(
          await readLimitedJson(response, imageGenerationMaxResponseBytes),
          outputFormat,
        )
      } catch (error) {
        if (error instanceof ProviderGatewayError) {
          throw error
        }
        throw classifyFetchFailure(error, controller.signal.aborted && !input.signal?.aborted)
      } finally {
        clearTimeout(timeout)
        unlinkAbortSignal()
      }
    },

    async editImage(input) {
      const provider = resolveAdapterProvider(input)
      if (provider.providerType !== 'openai_compatible' || !['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType) || input.image.byteLength < 1 || input.image.byteLength > 50 * 1024 * 1024) {
        throw new ProviderGatewayError('rejected', false)
      }
      const prompt = requireImagePrompt(input.parameters)
      const outputFormat = (optionalEnum(input.parameters, 'outputFormat', ['png', 'jpeg', 'webp']) ?? 'png') as 'png' | 'jpeg' | 'webp'
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), imageGenerationTimeoutMs)
      const unlinkAbortSignal = linkAbortSignal(input.signal, controller)
      try {
        if (controller.signal.aborted) throw new ProviderGatewayError('network', true)
        const form = new FormData()
        form.set('model', input.model)
        form.set('prompt', prompt)
        form.set('output_format', outputFormat)
        form.set('image', new Blob([input.image], { type: input.mimeType }), `source.${input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType.slice(6)}`)
        const response = await providerFetch(resolveProviderEndpoint(provider.providerType, provider.baseUrl, 'image_edit'), {
          method: 'POST', headers: { authorization: `Bearer ${input.apiKey}` }, body: form, redirect: 'error', signal: controller.signal,
        })
        if (!response.ok) {
          await consumeLimitedResponse(response, PROVIDER_CONNECTION_TEST_MAX_RESPONSE_BYTES)
          throw classifyResponse(response.status)
        }
        return parseImageGenerationResponse(await readLimitedJson(response, imageGenerationMaxResponseBytes), outputFormat)
      } catch (error) {
        if (error instanceof ProviderGatewayError) throw error
        throw classifyFetchFailure(error, controller.signal.aborted && !input.signal?.aborted)
      } finally {
        clearTimeout(timeout)
        unlinkAbortSignal()
      }
    },

    async submitAliyunImageTask(input) {
      const provider = resolveAdapterProvider(input)
      if (provider.providerType !== 'aliyun_dashscope' || input.model !== 'wanx2.1-t2i-turbo') {
        throw new ProviderGatewayError('rejected', false)
      }
      const prompt = requireImagePrompt(input.parameters)
      const size = optionalAliyunImageSize(input.parameters)
      const negativePrompt = optionalNegativePrompt(input.parameters)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), imageGenerationTimeoutMs)
      const unlinkAbortSignal = linkAbortSignal(input.signal, controller)
      try {
        if (controller.signal.aborted) throw new ProviderGatewayError('network', true)
        const response = await providerFetch(resolveProviderEndpoint(provider.providerType, provider.baseUrl, 'image_async_submission'), {
          method: 'POST',
          headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json', 'x-dashscope-async': 'enable' },
          body: JSON.stringify({
            model: input.model,
            input: { prompt },
            parameters: { size, watermark: false, prompt_extend: true, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) },
          }),
          redirect: 'error', signal: controller.signal,
        })
        if (!response.ok) {
          await consumeLimitedResponse(response, PROVIDER_CONNECTION_TEST_MAX_RESPONSE_BYTES)
          throw classifyResponse(response.status)
        }
        return { remoteTaskId: requireAliyunRemoteTaskId(await readLimitedJson(response, imageGenerationMaxResponseBytes)) }
      } catch (error) {
        if (error instanceof ProviderGatewayError) throw error
        throw classifyFetchFailure(error, controller.signal.aborted && !input.signal?.aborted)
      } finally {
        clearTimeout(timeout)
        unlinkAbortSignal()
      }
    },

    async pollAliyunImageTask(input) {
      const provider = resolveAdapterProvider(input)
      if (provider.providerType !== 'aliyun_dashscope') {
        throw new ProviderGatewayError('rejected', false)
      }
      let endpoint: string
      try {
        endpoint = resolveProviderTaskEndpoint(provider.providerType, provider.baseUrl, input.remoteTaskId)
      } catch {
        throw new ProviderGatewayError('rejected', false)
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), imageGenerationTimeoutMs)
      const unlinkAbortSignal = linkAbortSignal(input.signal, controller)
      try {
        if (controller.signal.aborted) throw new ProviderGatewayError('network', true)
        const response = await providerFetch(endpoint, {
          method: 'GET', headers: { authorization: `Bearer ${input.apiKey}` }, redirect: 'error', signal: controller.signal,
        })
        if (!response.ok) {
          await consumeLimitedResponse(response, PROVIDER_CONNECTION_TEST_MAX_RESPONSE_BYTES)
          throw classifyResponse(response.status)
        }
        return parseAliyunImageTask(await readLimitedJson(response, imageGenerationMaxResponseBytes))
      } catch (error) {
        if (error instanceof ProviderGatewayError) throw error
        throw classifyFetchFailure(error, controller.signal.aborted && !input.signal?.aborted)
      } finally {
        clearTimeout(timeout)
        unlinkAbortSignal()
      }
    },

    async submitAliyunVideoTask(input) {
      const provider = resolveAdapterProvider(input)
      if (provider.providerType !== 'aliyun_dashscope' || input.model !== 'wan2.7-t2v') {
        throw new ProviderGatewayError('rejected', false)
      }
      const prompt = requireImagePrompt(input.parameters)
      const resolution = requireAliyunVideoResolution(input.parameters)
      const ratio = requireAliyunVideoRatio(input.parameters)
      const duration = requireAliyunVideoDuration(input.parameters)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), imageGenerationTimeoutMs)
      const unlinkAbortSignal = linkAbortSignal(input.signal, controller)
      try {
        if (controller.signal.aborted) throw new ProviderGatewayError('network', true)
        const response = await providerFetch(resolveProviderEndpoint(provider.providerType, provider.baseUrl, 'video_async_submission'), {
          method: 'POST',
          headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json', 'x-dashscope-async': 'enable' },
          body: JSON.stringify({
            model: input.model,
            input: { prompt },
            parameters: { resolution, ratio, duration, prompt_extend: true, watermark: false },
          }),
          redirect: 'error', signal: controller.signal,
        })
        if (!response.ok) {
          await consumeLimitedResponse(response, PROVIDER_CONNECTION_TEST_MAX_RESPONSE_BYTES)
          throw classifyResponse(response.status)
        }
        return { remoteTaskId: requireAliyunRemoteTaskId(await readLimitedJson(response, imageGenerationMaxResponseBytes)) }
      } catch (error) {
        if (error instanceof ProviderGatewayError) throw error
        throw classifyFetchFailure(error, controller.signal.aborted && !input.signal?.aborted)
      } finally {
        clearTimeout(timeout)
        unlinkAbortSignal()
      }
    },

    async pollAliyunVideoTask(input) {
      const provider = resolveAdapterProvider(input)
      if (provider.providerType !== 'aliyun_dashscope') {
        throw new ProviderGatewayError('rejected', false)
      }
      let endpoint: string
      try {
        endpoint = resolveProviderTaskEndpoint(provider.providerType, provider.baseUrl, input.remoteTaskId)
      } catch {
        throw new ProviderGatewayError('rejected', false)
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), imageGenerationTimeoutMs)
      const unlinkAbortSignal = linkAbortSignal(input.signal, controller)
      try {
        if (controller.signal.aborted) throw new ProviderGatewayError('network', true)
        const response = await providerFetch(endpoint, {
          method: 'GET', headers: { authorization: `Bearer ${input.apiKey}` }, redirect: 'error', signal: controller.signal,
        })
        if (!response.ok) {
          await consumeLimitedResponse(response, PROVIDER_CONNECTION_TEST_MAX_RESPONSE_BYTES)
          throw classifyResponse(response.status)
        }
        return parseAliyunVideoTask(await readLimitedJson(response, imageGenerationMaxResponseBytes))
      } catch (error) {
        if (error instanceof ProviderGatewayError) throw error
        throw classifyFetchFailure(error, controller.signal.aborted && !input.signal?.aborted)
      } finally {
        clearTimeout(timeout)
        unlinkAbortSignal()
      }
    },
  }

  if (!options.metrics) return adapter
  const metrics = options.metrics
  async function observeProviderCall<T>(providerId: string, operation: string, call: () => Promise<T>) {
    const startedAt = performance.now()
    try {
      const result = await call()
      metrics.observe('provider_request_duration_seconds', (performance.now() - startedAt) / 1_000, {
        provider: providerId,
        operation,
        outcome: 'success',
      })
      return result
    } catch (error) {
      metrics.observe('provider_request_duration_seconds', (performance.now() - startedAt) / 1_000, {
        provider: providerId,
        operation,
        outcome: error instanceof ProviderGatewayError ? error.category : 'error',
      })
      throw error
    }
  }
  return {
    ...adapter,
    testConnection: (input) => observeProviderCall(input.providerId, 'connection_test', () => adapter.testConnection(input)),
    generateImage: (input) => observeProviderCall(input.providerId, 'image_generation', () => adapter.generateImage(input)),
    editImage: (input) => observeProviderCall(input.providerId, 'image_edit', () => adapter.editImage(input)),
    submitAliyunImageTask: (input) => observeProviderCall(input.providerId, 'image_async_submission', () => adapter.submitAliyunImageTask(input)),
    pollAliyunImageTask: (input) => observeProviderCall(input.providerId, 'image_async_poll', () => adapter.pollAliyunImageTask(input)),
    submitAliyunVideoTask: (input) => observeProviderCall(input.providerId, 'video_async_submission', () => adapter.submitAliyunVideoTask(input)),
    pollAliyunVideoTask: (input) => observeProviderCall(input.providerId, 'video_async_poll', () => adapter.pollAliyunVideoTask(input)),
  }
}
