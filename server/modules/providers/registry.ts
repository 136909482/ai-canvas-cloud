import type { CloudProviderId } from '@ai-canvas-cloud/contracts'

export type ProviderEndpointKind = 'chat' | 'image_generation' | 'image_edit'

export interface CloudProviderDefinition {
  id: CloudProviderId
  label: string
  defaultBaseUrl: string
  allowedBaseUrls: readonly string[]
  endpoints: Partial<Record<ProviderEndpointKind, string>>
}

const PROVIDER_DEFINITIONS: readonly CloudProviderDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com',
    allowedBaseUrls: ['https://api.openai.com'],
    endpoints: {
      chat: '/v1/chat/completions',
      image_generation: '/v1/images/generations',
      image_edit: '/v1/images/edits',
    },
  },
  {
    id: 'aliyun',
    label: '阿里百炼',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    allowedBaseUrls: ['https://dashscope.aliyuncs.com/compatible-mode/v1'],
    endpoints: {
      chat: '/compatible-mode/v1/chat/completions',
      image_generation: '/api/v1/services/aigc/multimodal-generation/generation',
    },
  },
] as const

export function listCloudProviderDefinitions() {
  return PROVIDER_DEFINITIONS
}

export function getCloudProviderDefinition(providerId: string) {
  return PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId) ?? null
}

function canonicalizeHttpsUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Provider base URL must be a valid HTTPS URL')
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.port && url.port !== '443')
  ) {
    throw new Error('Provider base URL is not allowed')
  }

  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  return `${url.origin}${pathname}`
}

export function normalizeProviderBaseUrl(providerId: string, value?: string) {
  const definition = getCloudProviderDefinition(providerId)
  if (!definition) {
    throw new Error('Provider is not supported')
  }
  const normalized = canonicalizeHttpsUrl(value?.trim() || definition.defaultBaseUrl)
  if (!definition.allowedBaseUrls.includes(normalized)) {
    throw new Error('Provider base URL is not in the server allowlist')
  }
  return normalized
}

export function resolveProviderEndpoint(providerId: string, endpointKind: ProviderEndpointKind) {
  const definition = getCloudProviderDefinition(providerId)
  if (!definition) {
    throw new Error('Provider is not supported')
  }
  const endpointPath = definition.endpoints[endpointKind]
  if (!endpointPath) {
    throw new Error('Provider endpoint is not supported')
  }
  const baseUrl = normalizeProviderBaseUrl(providerId)
  const base = new URL(baseUrl)
  return `${base.origin}${endpointPath}`
}
