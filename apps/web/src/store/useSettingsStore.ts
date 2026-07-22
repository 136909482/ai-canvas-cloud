import { create } from 'zustand'
import { reportDiagnostic } from './useDiagnosticsStore.ts'
import { platformBridge } from '../platform/index.ts'
import {
  LOCAL_VAULT_SCHEMA_VERSION,
  forgetRememberedLocalVault,
  isLocalVaultSupported,
  loadRememberedLocalVault,
  saveRememberedLocalVault,
  type LocalVaultDocument,
  type LocalVaultPersistence,
} from '../features/settings/localVault.ts'
import { useTaskQueueStore } from './useTaskQueueStore.ts'
import type { WorkspacePermissionState, WorkspaceStatus } from '../platform/types.ts'
import type {
  ApiConfig,
  CustomImageModelConfig,
  CustomModelKind,
  ModelTestStatus,
  ProviderProfileConfig,
  RuntimeModelConfig,
  StorageConfig,
} from '../types/index.ts'
import {
  clearDeviceOnlySettingsCache,
  clearLegacyPersistedConfig,
  readLegacyPersistedConfig,
  readWorkspaceConfigCache,
  writeWorkspaceConfigCache,
} from './settingsCache'
import {
  fromWorkspaceConfigFile,
  normalizeConfig,
  normalizeCustomModel,
  normalizeProviderProfile,
  toWorkspaceConfigFile,
} from './settingsConfig'

export type LocalVaultStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SettingsRuntimeState {
  workspaceConfigured: boolean
  workspaceDirectoryName: string
  workspacePermission: WorkspacePermissionState
  hydrated: boolean
  lastLoadError: string | null
  lastSaveError: string | null
  vaultStatus: LocalVaultStatus
  vaultPersistence: LocalVaultPersistence
  vaultUserId: string | null
  vaultUpdatedAt: number | null
  vaultError: string | null
}

interface SettingsStore {
  config: ApiConfig
  runtime: SettingsRuntimeState
  setStorageSettings: (patch: Partial<StorageConfig>) => void
  setWorkspaceRuntimeStatus: (status: Pick<WorkspaceStatus, 'configured' | 'directoryName' | 'permission'>) => void
  hydrateFromWorkspace: () => Promise<'workspace' | 'legacy' | 'default'>
  persistWorkspaceConfig: () => Promise<void>
  hydrateLocalVault: (userId: string) => Promise<'device' | 'legacy' | 'empty' | 'session'>
  persistLocalVault: () => Promise<void>
  setVaultPersistence: (persistence: LocalVaultPersistence) => Promise<void>
  forgetDeviceVault: () => Promise<void>
  clearVaultSession: () => void
  setDefaultModel: (modelId: string) => void
  saveCustomModel: (model: CustomImageModelConfig) => void
  deleteCustomModel: (id: string) => void
  saveProviderProfile: (profile: ProviderProfileConfig) => void
  deleteProviderProfile: (id: string) => void
  setActiveProviderProfile: (kind: CustomModelKind, profileId: string) => void
  setModelProviderProfile: (modelId: string, profileId: string | null) => void
  setCustomModelTestState: (
    id: string,
    status: ModelTestStatus,
    message: string,
    testedAt?: number | null,
  ) => void
  setProviderProfileTestState: (
    id: string,
    status: ModelTestStatus,
    message: string,
    testedAt?: number | null,
  ) => void
  getCustomModels: () => CustomImageModelConfig[]
  getEnabledCustomModels: (kind?: CustomModelKind) => CustomImageModelConfig[]
  getProviderProfiles: (kind?: CustomModelKind) => ProviderProfileConfig[]
  getActiveProviderProfile: (kind: CustomModelKind) => ProviderProfileConfig | undefined
  getResolvedProviderProfile: (modelId?: string, kind?: CustomModelKind, profileId?: string | null) => ProviderProfileConfig | undefined
  getModelConfig: (modelId?: string, kind?: CustomModelKind, profileId?: string | null) => RuntimeModelConfig | undefined
}

function createDefaultRuntimeState(): SettingsRuntimeState {
  return {
    workspaceConfigured: false,
    workspaceDirectoryName: '',
    workspacePermission: 'prompt',
    hydrated: false,
    lastLoadError: null,
    lastSaveError: null,
    vaultStatus: 'idle',
    vaultPersistence: 'device',
    vaultUserId: null,
    vaultUpdatedAt: null,
    vaultError: null,
  }
}

function withoutPrivateSettings(config: ApiConfig): ApiConfig {
  return normalizeConfig({
    model: '',
    customModels: [],
    providerProfiles: [],
    activeProviderProfileIds: {},
    modelProviderProfileIds: {},
    storage: config.storage,
  })
}

function mergeLocalVaultDocument(config: ApiConfig, document: LocalVaultDocument): ApiConfig {
  return normalizeConfig({
    model: document.defaultModelId,
    customModels: document.customModels,
    providerProfiles: document.providerProfiles,
    activeProviderProfileIds: document.activeProviderProfileIds,
    modelProviderProfileIds: document.modelProviderProfileIds,
    storage: config.storage,
  })
}

function createLocalVaultDocument(config: ApiConfig, userId: string, updatedAt = Date.now()): LocalVaultDocument {
  const normalized = normalizeConfig(config)
  return {
    schemaVersion: LOCAL_VAULT_SCHEMA_VERSION,
    userId,
    defaultModelId: normalized.model,
    customModels: normalized.customModels,
    providerProfiles: normalized.providerProfiles,
    activeProviderProfileIds: normalized.activeProviderProfileIds,
    modelProviderProfileIds: normalized.modelProviderProfileIds,
    updatedAt,
  }
}

let localVaultWriteChain = Promise.resolve()

function normalizeWorkspaceRuntimeStatus(status: Pick<WorkspaceStatus, 'configured' | 'directoryName' | 'permission'>) {
  return {
    workspaceConfigured: status.configured && status.permission !== 'denied',
    workspaceDirectoryName: status.permission === 'denied' ? '' : status.directoryName,
    workspacePermission: status.permission,
  }
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  config: normalizeConfig(),
  runtime: createDefaultRuntimeState(),

  setStorageSettings: (patch) =>
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        storage: {
          ...state.config.storage,
          ...patch,
          workspaceConfigured: state.config.storage.workspaceConfigured,
          workspaceDirectoryName: state.config.storage.workspaceDirectoryName,
        },
      }),
    })),

  setWorkspaceRuntimeStatus: (status) =>
    set((state) => ({
      config: {
        ...state.config,
        storage: {
          ...state.config.storage,
          ...normalizeWorkspaceRuntimeStatus(status),
        },
      },
      runtime: {
        ...state.runtime,
        ...normalizeWorkspaceRuntimeStatus(status),
      },
    })),

  hydrateFromWorkspace: async () => {
    const legacyConfig = readLegacyPersistedConfig()
    const cachedWorkspaceConfig = readWorkspaceConfigCache()

    try {
      const workspaceConfig = await platformBridge.loadWorkspaceConfig()
      const hydratedConfig = fromWorkspaceConfigFile(workspaceConfig ?? cachedWorkspaceConfig)

      if (workspaceConfig) {
        writeWorkspaceConfigCache(workspaceConfig)
      }

      if (hydratedConfig) {
        set((state) => ({
          config: {
            ...hydratedConfig,
            storage: {
              ...hydratedConfig.storage,
              workspaceConfigured: state.runtime.workspaceConfigured,
              workspaceDirectoryName: state.runtime.workspaceDirectoryName,
            },
          },
          runtime: {
            ...state.runtime,
            hydrated: true,
            lastLoadError: null,
          },
        }))
        return workspaceConfig ? 'workspace' as const : 'default' as const
      }

      if (legacyConfig) {
        const migratedConfig = withoutPrivateSettings(normalizeConfig(legacyConfig))
        set((state) => ({
          config: {
            ...migratedConfig,
            storage: {
              ...migratedConfig.storage,
              workspaceConfigured: state.runtime.workspaceConfigured,
              workspaceDirectoryName: state.runtime.workspaceDirectoryName,
            },
          },
          runtime: {
            ...state.runtime,
            hydrated: true,
            lastLoadError: null,
          },
        }))

        if (get().runtime.workspaceConfigured) {
          await get().persistWorkspaceConfig()
        }
        return 'legacy' as const
      }

      const defaultConfig = normalizeConfig()
      set((state) => ({
        config: {
          ...defaultConfig,
          storage: {
            ...defaultConfig.storage,
            workspaceConfigured: state.runtime.workspaceConfigured,
            workspaceDirectoryName: state.runtime.workspaceDirectoryName,
          },
        },
        runtime: {
          ...state.runtime,
          hydrated: true,
          lastLoadError: null,
        },
      }))

      return 'default' as const
    } catch (error) {
      const hydratedConfig = fromWorkspaceConfigFile(cachedWorkspaceConfig)

      if (hydratedConfig) {
        set((state) => ({
          config: {
            ...hydratedConfig,
            storage: {
              ...hydratedConfig.storage,
              workspaceConfigured: state.runtime.workspaceConfigured,
              workspaceDirectoryName: state.runtime.workspaceDirectoryName,
            },
          },
          runtime: {
            ...state.runtime,
            hydrated: true,
            lastLoadError: error instanceof Error ? error.message : String(error),
          },
        }))
        return 'default' as const
      }

      const defaultConfig = normalizeConfig()
      set((state) => ({
        config: {
          ...defaultConfig,
          storage: {
            ...defaultConfig.storage,
            workspaceConfigured: state.runtime.workspaceConfigured,
            workspaceDirectoryName: state.runtime.workspaceDirectoryName,
          },
        },
        runtime: {
          ...state.runtime,
          hydrated: true,
          lastLoadError: error instanceof Error ? error.message : String(error),
        },
      }))
      return 'default' as const
    }
  },

  persistWorkspaceConfig: async () => {
    const state = get()
    const workspaceConfig = toWorkspaceConfigFile(state.config)

    writeWorkspaceConfigCache(workspaceConfig)

    if (!state.runtime.workspaceConfigured) {
      set((current) => ({
        runtime: {
          ...current.runtime,
          lastSaveError: null,
        },
      }))
      return
    }

    try {
      await platformBridge.saveWorkspaceConfig(workspaceConfig)
      set((current) => ({
        runtime: {
          ...current.runtime,
          lastSaveError: null,
        },
      }))
    } catch (error) {
      reportDiagnostic({
        area: 'persistence',
        title: '配置保存失败',
        error,
        code: 'WORKSPACE_CONFIG_SAVE_FAILED',
        context: { operation: 'save-config' },
      })
      set((current) => ({
        runtime: {
          ...current.runtime,
          lastSaveError: error instanceof Error ? error.message : String(error),
        },
      }))
      throw error
    }
  },

  hydrateLocalVault: async (userId) => {
    const normalizedUserId = userId.trim()
    if (!normalizedUserId) {
      get().clearVaultSession()
      return 'session'
    }

    set((state) => ({
      config: withoutPrivateSettings(state.config),
      runtime: {
        ...state.runtime,
        vaultStatus: 'loading',
        vaultPersistence: 'device',
        vaultUserId: normalizedUserId,
        vaultUpdatedAt: null,
        vaultError: null,
      },
    }))

    try {
      if (isLocalVaultSupported()) {
        const remembered = await loadRememberedLocalVault(normalizedUserId)
        if (remembered) {
          set((state) => ({
            config: mergeLocalVaultDocument(state.config, remembered),
            runtime: {
              ...state.runtime,
              vaultStatus: 'ready',
              vaultPersistence: 'device',
              vaultUserId: normalizedUserId,
              vaultUpdatedAt: remembered.updatedAt,
              vaultError: null,
            },
          }))
          clearLegacyPersistedConfig()
          return 'device'
        }
      }

      const legacyConfig = readLegacyPersistedConfig()
      if (legacyConfig) {
        const migratedConfig = normalizeConfig(legacyConfig)
        set((state) => ({
          config: normalizeConfig({
            ...migratedConfig,
            storage: state.config.storage,
          }),
        }))

        if (isLocalVaultSupported()) {
          await get().persistLocalVault()
        } else {
          set((state) => ({
            runtime: {
              ...state.runtime,
              vaultStatus: 'ready',
              vaultPersistence: 'session',
              vaultUserId: normalizedUserId,
              vaultUpdatedAt: null,
              vaultError: '当前浏览器不支持加密设备存储，配置仅保留在本次会话。',
            },
          }))
        }
        clearLegacyPersistedConfig()
        return 'legacy'
      }

      if (isLocalVaultSupported()) {
        await get().persistLocalVault()
        return 'empty'
      }

      set((state) => ({
        runtime: {
          ...state.runtime,
          vaultStatus: 'ready',
          vaultPersistence: 'session',
          vaultUserId: normalizedUserId,
          vaultUpdatedAt: null,
          vaultError: '当前浏览器不支持加密设备存储，配置仅保留在本次会话。',
        },
      }))
      return 'session'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({
        config: withoutPrivateSettings(state.config),
        runtime: {
          ...state.runtime,
          vaultStatus: 'error',
          vaultPersistence: 'session',
          vaultUserId: normalizedUserId,
          vaultUpdatedAt: null,
          vaultError: message,
        },
      }))
      return 'session'
    }
  },

  persistLocalVault: async () => {
    const state = get()
    const userId = state.runtime.vaultUserId

    if (!userId || state.runtime.vaultPersistence !== 'device') {
      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultStatus: userId ? 'ready' : current.runtime.vaultStatus,
          vaultError: null,
        },
      }))
      return
    }

    if (!isLocalVaultSupported()) {
      throw new Error('当前浏览器不支持加密设备存储。')
    }

    const document = createLocalVaultDocument(state.config, userId)
    const write = localVaultWriteChain.then(() => saveRememberedLocalVault(document))
    localVaultWriteChain = write.catch(() => undefined)

    try {
      await write
      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultStatus: 'ready',
          vaultUpdatedAt: document.updatedAt,
          vaultError: null,
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultStatus: 'error',
          vaultError: message,
        },
      }))
      throw error
    }
  },

  setVaultPersistence: async (persistence) => {
    const state = get()
    const previousPersistence = state.runtime.vaultPersistence

    if (persistence === previousPersistence) return

    if (persistence === 'session') {
      try {
        if (state.runtime.vaultUserId && isLocalVaultSupported()) {
          await forgetRememberedLocalVault(state.runtime.vaultUserId)
        }
        set((current) => ({
          runtime: {
            ...current.runtime,
            vaultPersistence: 'session',
            vaultStatus: current.runtime.vaultUserId ? 'ready' : current.runtime.vaultStatus,
            vaultUpdatedAt: null,
            vaultError: null,
          },
        }))
      } catch (error) {
        set((current) => ({
          runtime: {
            ...current.runtime,
            vaultStatus: 'error',
            vaultError: error instanceof Error ? error.message : String(error),
          },
        }))
        throw error
      }
      return
    }

    set((current) => ({
      runtime: {
        ...current.runtime,
        vaultPersistence: 'device',
        vaultStatus: current.runtime.vaultUserId ? 'ready' : current.runtime.vaultStatus,
        vaultError: null,
      },
    }))

    try {
      await get().persistLocalVault()
    } catch (error) {
      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultPersistence: previousPersistence,
        },
      }))
      throw error
    }
  },

  forgetDeviceVault: async () => {
    const userId = get().runtime.vaultUserId
    if (userId && isLocalVaultSupported()) {
      await forgetRememberedLocalVault(userId)
    }

    clearLegacyPersistedConfig()
    clearDeviceOnlySettingsCache()
    useTaskQueueStore.getState().clearDeviceCache()
    set((state) => ({
      config: withoutPrivateSettings(state.config),
      runtime: {
        ...state.runtime,
        vaultStatus: userId ? 'ready' : 'idle',
        vaultPersistence: 'session',
        vaultUpdatedAt: null,
        vaultError: null,
      },
    }))
  },

  clearVaultSession: () => {
    set((state) => ({
      config: withoutPrivateSettings(state.config),
      runtime: {
        ...state.runtime,
        vaultStatus: 'idle',
        vaultPersistence: 'device',
        vaultUserId: null,
        vaultUpdatedAt: null,
        vaultError: null,
      },
    }))
  },

  setDefaultModel: (modelId) => {
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        model: modelId,
      }),
    }))
    void get().persistLocalVault().catch(() => undefined)
  },

  saveCustomModel: (model) => {
    set((state) => {
      const normalized = normalizeConfig(state.config)
      const nextModel = normalizeCustomModel(model)
      const existingIndex = normalized.customModels.findIndex((item) => item.id === nextModel.id)
      const customModels = existingIndex >= 0
        ? normalized.customModels.map((item, index) => (index === existingIndex ? nextModel : item))
        : [...normalized.customModels, nextModel]

      return {
        config: normalizeConfig({
          ...normalized,
          customModels,
          model:
            normalized.model && customModels.some((item) => item.enabled && item.modelId === normalized.model)
              ? normalized.model
              : nextModel.enabled
                ? nextModel.modelId
                : normalized.model,
        }),
      }
    })
    void get().persistLocalVault().catch(() => undefined)
  },

  deleteCustomModel: (id) => {
    set((state) => {
      const normalized = normalizeConfig(state.config)
      const deletedModel = normalized.customModels.find((model) => model.id === id)
      const customModels = normalized.customModels.filter((model) => model.id !== id)

      return {
        config: normalizeConfig({
          ...normalized,
          customModels,
          modelProviderProfileIds: Object.fromEntries(
            Object.entries(normalized.modelProviderProfileIds).filter(([modelId]) => modelId !== deletedModel?.modelId),
          ),
        }),
      }
    })
    void get().persistLocalVault().catch(() => undefined)
  },

  saveProviderProfile: (profile) => {
    set((state) => {
      const normalized = normalizeConfig(state.config)
      const nextProfile = normalizeProviderProfile(profile)
      const existingIndex = normalized.providerProfiles.findIndex((item) => item.id === nextProfile.id)
      const providerProfiles = existingIndex >= 0
        ? normalized.providerProfiles.map((item, index) => (index === existingIndex ? nextProfile : item))
        : [...normalized.providerProfiles, nextProfile]

      return {
        config: normalizeConfig({
          ...normalized,
          providerProfiles,
          activeProviderProfileIds: {
            ...normalized.activeProviderProfileIds,
            [nextProfile.kind]: normalized.activeProviderProfileIds[nextProfile.kind] ?? nextProfile.id,
          },
        }),
      }
    })
    void get().persistLocalVault().catch(() => undefined)
  },

  deleteProviderProfile: (id) => {
    set((state) => {
      const normalized = normalizeConfig(state.config)
      const providerProfiles = normalized.providerProfiles.filter((profile) => profile.id !== id)

      return {
        config: normalizeConfig({
          ...normalized,
          providerProfiles,
          activeProviderProfileIds: Object.fromEntries(
            Object.entries(normalized.activeProviderProfileIds).filter(([, profileId]) => profileId !== id),
          ) as Partial<Record<CustomModelKind, string>>,
          modelProviderProfileIds: Object.fromEntries(
            Object.entries(normalized.modelProviderProfileIds).filter(([, profileId]) => profileId !== id),
          ),
        }),
      }
    })
    void get().persistLocalVault().catch(() => undefined)
  },

  setActiveProviderProfile: (kind, profileId) => {
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        activeProviderProfileIds: {
          ...state.config.activeProviderProfileIds,
          [kind]: profileId,
        },
      }),
    }))
    void get().persistLocalVault().catch(() => undefined)
  },

  setModelProviderProfile: (modelId, profileId) => {
    set((state) => {
      const normalized = normalizeConfig(state.config)
      const trimmedModelId = modelId.trim()
      const model = normalized.customModels.find((item) => item.modelId === trimmedModelId)
      const normalizedProviderId = profileId?.trim() ?? ''
      const modelProviderProfileIds = { ...normalized.modelProviderProfileIds }

      if (!model || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(normalizedProviderId)) {
        delete modelProviderProfileIds[trimmedModelId]
      } else {
        modelProviderProfileIds[trimmedModelId] = normalizedProviderId
      }

      return {
        config: normalizeConfig({
          ...normalized,
          modelProviderProfileIds,
        }),
      }
    })
    void get().persistLocalVault().catch(() => undefined)
  },

  setCustomModelTestState: (id, status, message, testedAt = Date.now()) => {
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        customModels: state.config.customModels.map((model) =>
          model.id === id
            ? {
                ...model,
                testStatus: status,
                testMessage: message,
                lastTestedAt: testedAt,
              }
            : model,
        ),
      }),
    }))
    void get().persistLocalVault().catch(() => undefined)
  },

  setProviderProfileTestState: (id, status, message, testedAt = Date.now()) => {
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        providerProfiles: state.config.providerProfiles.map((profile) =>
          profile.id === id
            ? {
                ...profile,
                testStatus: status,
                testMessage: message,
                lastTestedAt: testedAt,
              }
            : profile,
        ),
      }),
    }))
    void get().persistLocalVault().catch(() => undefined)
  },

  getCustomModels: () => normalizeConfig(get().config).customModels,

  getEnabledCustomModels: (kind) =>
    normalizeConfig(get().config).customModels.filter(
      (model) => model.enabled && (kind ? model.kind === kind : true),
    ),

  getProviderProfiles: (kind) =>
    normalizeConfig(get().config).providerProfiles.filter(
      (profile) => profile.enabled && (kind ? profile.kind === kind : true),
    ),

  getActiveProviderProfile: (kind) => {
    const normalized = normalizeConfig(get().config)
    const activeId = normalized.activeProviderProfileIds[kind]
    return normalized.providerProfiles.find((profile) => profile.enabled && profile.kind === kind && profile.id === activeId)
      ?? normalized.providerProfiles.find((profile) => profile.enabled && profile.kind === kind)
  },

  getResolvedProviderProfile: (modelId, kind, profileId) => {
    const normalized = normalizeConfig(get().config)
    const model = normalized.customModels.find((item) => (
      item.modelId === modelId
      && (kind ? item.kind === kind : true)
    ))
    const resolvedKind = kind ?? model?.kind ?? 'image'
    const modelProfileId = model?.modelId ? normalized.modelProviderProfileIds[model.modelId] : undefined

    return (profileId
      ? normalized.providerProfiles.find((item) => item.enabled && item.id === profileId && item.kind === resolvedKind)
      : undefined)
      ?? (modelProfileId
        ? normalized.providerProfiles.find((item) => item.enabled && item.id === modelProfileId && item.kind === resolvedKind)
        : undefined)
      ?? normalized.providerProfiles.find((item) => item.enabled && item.id === normalized.activeProviderProfileIds[resolvedKind] && item.kind === resolvedKind)
      ?? normalized.providerProfiles.find((item) => item.enabled && item.kind === resolvedKind)
  },

  getModelConfig: (modelId, kind, profileId) => {
    const normalized = normalizeConfig(get().config)
    const model = normalized.customModels.find((item) => (
      item.enabled
      && item.modelId === modelId
      && (kind ? item.kind === kind : true)
    ))
    const profile = get().getResolvedProviderProfile(modelId, kind ?? model?.kind, profileId)

    if (!model || !profile) {
      return undefined
    }

    return {
      ...model,
      apiKey: profile.apiKey,
      apiUrl: profile.apiUrl,
      provider: profile.provider,
      requestMode: profile.requestMode,
      asyncConfig: profile.asyncConfig,
    }
  },
}))
