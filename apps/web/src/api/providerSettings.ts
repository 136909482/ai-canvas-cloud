import type {
  CloudProviderId,
  DeleteProviderCredentialResponse,
  ProviderConnectionTestResponse,
  ProviderSettingResponse,
  ProviderSettingsResponse,
} from '@ai-canvas-cloud/contracts'
import { requestCloudJson } from './cloudApiClient.ts'

type CloudRequest = <TResponse>(path: string, options?: RequestInit) => Promise<TResponse>

function providerPath(providerId: CloudProviderId) {
  return `/settings/providers/${encodeURIComponent(providerId)}`
}

export function createCloudProviderSettingsApi(request: CloudRequest = requestCloudJson) {
  return {
    list() {
      return request<ProviderSettingsResponse>('/settings/providers')
    },

    update(providerId: CloudProviderId, input: { apiKey: string; baseUrl?: string }) {
      return request<ProviderSettingResponse>(providerPath(providerId), {
        method: 'PUT',
        body: JSON.stringify(input),
      })
    },

    remove(providerId: CloudProviderId) {
      return request<DeleteProviderCredentialResponse>(providerPath(providerId), { method: 'DELETE' })
    },

    test(providerId: CloudProviderId) {
      return request<ProviderConnectionTestResponse>(`${providerPath(providerId)}/test`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
  }
}

export const cloudProviderSettingsApi = createCloudProviderSettingsApi()
