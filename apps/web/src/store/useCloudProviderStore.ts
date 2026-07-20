import { create } from 'zustand'
import type { ProviderSettingSummary } from '@ai-canvas-cloud/contracts'
import { cloudProviderSettingsApi } from '@/api/providerSettings'

type CloudProviderState = {
  providers: ProviderSettingSummary[]
  loading: boolean
  error: string
  load: () => Promise<void>
  upsert: (provider: ProviderSettingSummary) => void
  remove: (providerId: string) => void
}

export const useCloudProviderStore = create<CloudProviderState>((set) => ({
  providers: [],
  loading: false,
  error: '',
  async load() {
    set({ loading: true, error: '' })
    try {
      const response = await cloudProviderSettingsApi.list()
      set({ providers: response.providers, loading: false })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
  upsert(provider) {
    set((state) => ({
      providers: [...state.providers.filter((item) => item.providerId !== provider.providerId), provider]
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
    }))
  },
  remove(providerId) {
    set((state) => ({ providers: state.providers.filter((provider) => provider.providerId !== providerId) }))
  },
}))
