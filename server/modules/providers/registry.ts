import { isIP } from 'node:net'
import type { GenerationTaskKind } from '@ai-canvas-cloud/contracts'

export type ProviderEndpointKind = 'chat' | 'image_generation' | 'image_edit' | 'image_async_submission' | 'video_async_submission'
export type CloudProviderType = 'openai_compatible' | 'aliyun_dashscope'

export interface CloudProviderDefinition {
  id: string
  label: string
  defaultBaseUrl: string
  providerType: CloudProviderType
}

const LEGACY_PROVIDER_DEFINITIONS: readonly CloudProviderDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com',
    providerType: 'openai_compatible',
  },
  {
    id: 'aliyun',
    label: '阿里百炼',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    providerType: 'aliyun_dashscope',
  },
] as const

export function listCloudProviderDefinitions() {
  return LEGACY_PROVIDER_DEFINITIONS
}

export function getCloudProviderDefinition(providerId: string) {
  return LEGACY_PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId) ?? null
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127)
}

function isPrivateIpv6(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
}

export function canonicalizeProviderBaseUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Provider base URL must be a valid HTTPS URL')
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.port && url.port !== '443')
    || value.length > 512
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || (isIP(hostname) === 4 && isPrivateIpv4(hostname))
    || (isIP(hostname) === 6 && isPrivateIpv6(hostname))
  ) {
    throw new Error('Provider base URL is not allowed')
  }

  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  return `${url.origin}${pathname}`
}

export function normalizeProviderBaseUrl(providerId: string, value?: string) {
  const definition = getCloudProviderDefinition(providerId)
  const candidate = value?.trim() || definition?.defaultBaseUrl
  if (!candidate) {
    throw new Error('Provider base URL is required')
  }
  return canonicalizeProviderBaseUrl(candidate)
}

function appendEndpoint(baseUrl: string, path: string) {
  const normalized = canonicalizeProviderBaseUrl(baseUrl)
  const url = new URL(normalized)
  const basePath = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${basePath}${path}`
}

export function resolveProviderEndpoint(providerId: string, endpointKind: ProviderEndpointKind): string
export function resolveProviderEndpoint(providerType: CloudProviderType, baseUrl: string, endpointKind: ProviderEndpointKind): string
export function resolveProviderEndpoint(providerOrType: string, baseUrlOrKind: string, maybeKind?: ProviderEndpointKind) {
  const legacy = maybeKind === undefined ? getCloudProviderDefinition(providerOrType) : null
  const providerType = (maybeKind === undefined ? legacy?.providerType : providerOrType) as CloudProviderType | undefined
  const baseUrl = maybeKind === undefined ? legacy?.defaultBaseUrl : baseUrlOrKind
  const endpointKind = (maybeKind ?? baseUrlOrKind) as ProviderEndpointKind
  if (!providerType || !baseUrl) throw new Error('Provider endpoint is not supported')
  if (providerType === 'openai_compatible') {
    const normalized = canonicalizeProviderBaseUrl(baseUrl)
    const hasVersionPath = new URL(normalized).pathname.replace(/\/+$/, '').length > 0
    const versionedBase = hasVersionPath ? normalized : `${normalized}/v1`
    const path = endpointKind === 'chat'
      ? '/chat/completions'
      : endpointKind === 'image_generation'
        ? '/images/generations'
        : endpointKind === 'image_edit'
          ? '/images/edits'
          : null
    if (!path) throw new Error('Provider endpoint is not supported')
    return appendEndpoint(versionedBase, path)
  }

  const origin = new URL(canonicalizeProviderBaseUrl(baseUrl)).origin
  const path = endpointKind === 'chat'
    ? '/compatible-mode/v1/chat/completions'
    : endpointKind === 'image_async_submission'
      ? '/api/v1/services/aigc/text2image/image-synthesis'
      : endpointKind === 'video_async_submission'
        ? '/api/v1/services/aigc/video-generation/video-synthesis'
        : null
  if (!path) throw new Error('Provider endpoint is not supported')
  return `${origin}${path}`
}

export function resolveProviderTestEndpoint(providerId: string): string
export function resolveProviderTestEndpoint(providerType: CloudProviderType, baseUrl: string): string
export function resolveProviderTestEndpoint(providerOrType: string, maybeBaseUrl?: string) {
  const legacy = maybeBaseUrl === undefined ? getCloudProviderDefinition(providerOrType) : null
  const providerType = (maybeBaseUrl === undefined ? legacy?.providerType : providerOrType) as CloudProviderType | undefined
  const baseUrl = maybeBaseUrl ?? legacy?.defaultBaseUrl
  if (!providerType || !baseUrl) throw new Error('Provider endpoint is not supported')
  if (providerType === 'openai_compatible') {
    const normalized = canonicalizeProviderBaseUrl(baseUrl)
    const hasVersionPath = new URL(normalized).pathname.replace(/\/+$/, '').length > 0
    return appendEndpoint(hasVersionPath ? normalized : `${normalized}/v1`, '/models')
  }
  return `${new URL(canonicalizeProviderBaseUrl(baseUrl)).origin}/compatible-mode/v1/models`
}

export function resolveProviderTaskEndpoint(providerId: string, remoteTaskId: string): string
export function resolveProviderTaskEndpoint(providerType: CloudProviderType, baseUrl: string, remoteTaskId: string): string
export function resolveProviderTaskEndpoint(providerOrType: string, baseUrlOrTaskId: string, maybeTaskId?: string) {
  const legacy = maybeTaskId === undefined ? getCloudProviderDefinition(providerOrType) : null
  const providerType = (maybeTaskId === undefined ? legacy?.providerType : providerOrType) as CloudProviderType | undefined
  const baseUrl = maybeTaskId === undefined ? legacy?.defaultBaseUrl : baseUrlOrTaskId
  const remoteTaskId = maybeTaskId ?? baseUrlOrTaskId
  if (!baseUrl || providerType !== 'aliyun_dashscope' || !/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(remoteTaskId)) {
    throw new Error('Provider task endpoint is not supported')
  }
  return `${new URL(canonicalizeProviderBaseUrl(baseUrl)).origin}/api/v1/tasks/${encodeURIComponent(remoteTaskId)}`
}

export function isAllowedProviderResultUrl(providerId: string, value: string): boolean
export function isAllowedProviderResultUrl(providerType: CloudProviderType, baseUrl: string, value: string): boolean
export function isAllowedProviderResultUrl(providerOrType: string, baseUrlOrValue: string, maybeValue?: string) {
  const legacy = maybeValue === undefined ? getCloudProviderDefinition(providerOrType) : null
  const providerType = (maybeValue === undefined ? legacy?.providerType : providerOrType) as CloudProviderType | undefined
  const baseUrl = maybeValue === undefined ? legacy?.defaultBaseUrl : baseUrlOrValue
  const value = maybeValue ?? baseUrlOrValue
  if (!providerType || !baseUrl) return false
  try {
    const result = new URL(value)
    const configured = new URL(canonicalizeProviderBaseUrl(baseUrl))
    return result.protocol === 'https:'
      && !result.username
      && !result.password
      && (!result.port || result.port === '443')
      && result.hostname === configured.hostname
  } catch {
    return false
  }
}

export function isProviderGenerationTaskEnabled(input: {
  providerType: CloudProviderType
  kind: GenerationTaskKind
  model: string
}) {
  if (input.providerType === 'openai_compatible') {
    return input.kind === 'image'
  }
  return input.kind === 'image' && input.model === 'wanx2.1-t2i-turbo'
    || input.kind === 'video' && input.model === 'wan2.7-t2v'
}
