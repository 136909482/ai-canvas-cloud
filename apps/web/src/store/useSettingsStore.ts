import { create } from 'zustand'
import { reportDiagnostic } from './useDiagnosticsStore.ts'
import { platformBridge } from '../platform/index.ts'
import {
  LOCAL_VAULT_SCHEMA_VERSION,
  LOCAL_TASK_CACHE_SCHEMA_VERSION,
  deleteRememberedLocalTaskQueue,
  isLocalVaultSupported,
  loadRememberedLocalTaskQueue,
  loadRememberedLocalVault,
  saveRememberedLocalTaskQueue,
  saveRememberedLocalVault,
  type LocalVaultDocument,
  type LocalVaultPersistence,
} from '../features/settings/localVault.ts'
import { useTaskQueueStore } from './useTaskQueueStore.ts'
import {
  createLocalModelReference,
  findLocalModelReference,
  isLocalModelReference,
  resolveLocalModelReference,
} from '../features/settings/localModelReferences.ts'
import type { WorkspacePermissionState, WorkspaceStatus } from '../platform/types.ts'
import type {
  ApiConfig,
  CustomImageModelConfig,
  CustomModelKind,
  ModelTestStatus,
  ProviderProfileConfig,
  RuntimeModelConfig,
  StorageConfig,
  TaskQueueSnapshot,
} from '../types/index.ts'
import {
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
  loadLocalTaskQueue: (projectId: string) => Promise<TaskQueueSnapshot | null>
  persistLocalTaskQueue: (projectId: string, taskQueue: TaskQueueSnapshot) => Promise<void>
  deleteLocalTaskQueue: (projectId: string) => Promise<void>
  clearVaultSession: () => void
  setDefaultModel: (modelId: string) => void
  saveCustomModel: (model: CustomImageModelConfig) => void
  deleteCustomModel: (id: string) => void
  saveProviderProfile: (profile: ProviderProfileConfig) => void
  deleteProviderProfile: (id: string) => void
  setActiveProviderProfile: (kind: CustomModelKind, profileId: string) => void
  setModelProviderProfile: (modelId: string, profileId: string | null) => void
  ensureLocalModelReference: (modelId: string) => string
  bindLocalModelReference: (reference: string, modelId: string) => boolean
  resolveLocalModelReference: (reference: string) => string | null
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
    localModelBindings: {},
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
    localModelBindings: document.localModelBindings,
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
    localModelBindings: normalized.localModelBindings,
    updatedAt,
  }
}

interface LocalVaultRuntimeContext {
  userId: string | null
  persistence: LocalVaultPersistence
  stateVersion: number
}

let localVaultOperationChain = Promise.resolve()
let localVaultStateVersion = 0
const sessionTaskQueues = new Map<string, TaskQueueSnapshot>()

function getSessionTaskQueueKey(userId: string, projectId: string) {
  return `${userId}\n${projectId}`
}

function cloneTaskQueue(taskQueue: TaskQueueSnapshot) {
  return structuredClone(taskQueue)
}

function clearSessionTaskQueues(userId?: string | null) {
  if (!userId) {
    sessionTaskQueues.clear()
    return
  }

  const prefix = `${userId}\n`
  for (const key of sessionTaskQueues.keys()) {
    if (key.startsWith(prefix)) sessionTaskQueues.delete(key)
  }
}

function advanceLocalVaultStateVersion() {
  localVaultStateVersion += 1
  return localVaultStateVersion
}

function enqueueLocalVaultOperation<T>(operation: () => Promise<T>) {
  const result = localVaultOperationChain.then(operation)
  localVaultOperationChain = result.then(() => undefined, () => undefined)
  return result
}

function isCurrentLocalVaultContext(runtime: SettingsRuntimeState, context: LocalVaultRuntimeContext) {
  return localVaultStateVersion === context.stateVersion
    && runtime.vaultUserId === context.userId
    && runtime.vaultPersistence === context.persistence
}

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

    const vaultSupported = isLocalVaultSupported()
    const persistence: LocalVaultPersistence = vaultSupported ? 'device' : 'session'
    const stateVersion = advanceLocalVaultStateVersion()
    const context: LocalVaultRuntimeContext = {
      userId: normalizedUserId,
      persistence,
      stateVersion,
    }

    set((state) => ({
      config: withoutPrivateSettings(state.config),
      runtime: {
        ...state.runtime,
        vaultStatus: 'loading',
        vaultPersistence: persistence,
        vaultUserId: normalizedUserId,
        vaultUpdatedAt: null,
        vaultError: null,
      },
    }))

    try {
      if (vaultSupported) {
        const remembered = await loadRememberedLocalVault(normalizedUserId)
        if (!isCurrentLocalVaultContext(get().runtime, context)) return 'session'

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
        if (!isCurrentLocalVaultContext(get().runtime, context)) return 'session'

        if (!vaultSupported) {
          set((state) => ({
            runtime: {
              ...state.runtime,
              vaultStatus: 'error',
              vaultPersistence: 'session',
              vaultUserId: normalizedUserId,
              vaultUpdatedAt: null,
              vaultError: '当前浏览器不支持加密设备存储，无法迁移或保存本地 Vault。',
            },
          }))
          return 'session'
        }

        const migratedConfig = normalizeConfig(legacyConfig)
        set((state) => ({
          config: normalizeConfig({
            ...migratedConfig,
            storage: state.config.storage,
          }),
        }))

        await get().persistLocalVault()
        if (!isCurrentLocalVaultContext(get().runtime, context)) return 'session'
        clearLegacyPersistedConfig()
        return 'legacy'
      }

      if (vaultSupported) {
        await get().persistLocalVault()
        return isCurrentLocalVaultContext(get().runtime, context) ? 'empty' : 'session'
      }

      if (!isCurrentLocalVaultContext(get().runtime, context)) return 'session'
      set((state) => ({
        runtime: {
          ...state.runtime,
          vaultStatus: 'error',
          vaultPersistence: 'session',
          vaultUserId: normalizedUserId,
          vaultUpdatedAt: null,
          vaultError: '当前浏览器不支持加密设备存储，无法保存本地 Vault。',
        },
      }))
      return 'session'
    } catch (error) {
      if (!isCurrentLocalVaultContext(get().runtime, context)) return 'session'

      const message = error instanceof Error ? error.message : String(error)
      advanceLocalVaultStateVersion()
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
    let state = get()
    const userId = state.runtime.vaultUserId

    if (!userId) return

    if (!isLocalVaultSupported()) {
      throw new Error('当前浏览器不支持加密设备存储。')
    }

    if (state.runtime.vaultPersistence !== 'device') {
      advanceLocalVaultStateVersion()
      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultPersistence: 'device',
          vaultStatus: 'ready',
          vaultError: null,
        },
      }))
      state = get()
    }

    const document = createLocalVaultDocument(state.config, userId)
    const context: LocalVaultRuntimeContext = {
      userId,
      persistence: 'device',
      stateVersion: localVaultStateVersion,
    }
    const write = enqueueLocalVaultOperation(() => saveRememberedLocalVault(document))

    try {
      await write
      if (!isCurrentLocalVaultContext(get().runtime, context)) return

      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultStatus: 'ready',
          vaultUpdatedAt: document.updatedAt,
          vaultError: null,
        },
      }))
    } catch (error) {
      if (!isCurrentLocalVaultContext(get().runtime, context)) throw error

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

  loadLocalTaskQueue: async (projectId) => {
    const normalizedProjectId = projectId.trim()
    const state = get()
    const userId = state.runtime.vaultUserId
    if (!normalizedProjectId || !userId) return null

    const sessionSnapshot = sessionTaskQueues.get(getSessionTaskQueueKey(userId, normalizedProjectId))
    if (sessionSnapshot) return cloneTaskQueue(sessionSnapshot)
    if (state.runtime.vaultPersistence !== 'device' || !isLocalVaultSupported()) return null

    const context: LocalVaultRuntimeContext = {
      userId,
      persistence: 'device',
      stateVersion: localVaultStateVersion,
    }
    const document = await enqueueLocalVaultOperation(() => loadRememberedLocalTaskQueue(userId, normalizedProjectId))
    if (!isCurrentLocalVaultContext(get().runtime, context)) return null
    if (!document) return null
    sessionTaskQueues.set(getSessionTaskQueueKey(userId, normalizedProjectId), cloneTaskQueue(document.taskQueue))
    return cloneTaskQueue(document.taskQueue)
  },

  persistLocalTaskQueue: async (projectId, taskQueue) => {
    const normalizedProjectId = projectId.trim()
    const state = get()
    const userId = state.runtime.vaultUserId

    if (!normalizedProjectId || !userId) return

    const taskQueueSnapshot = cloneTaskQueue(taskQueue)
    sessionTaskQueues.set(getSessionTaskQueueKey(userId, normalizedProjectId), taskQueueSnapshot)
    if (state.runtime.vaultPersistence !== 'device' || !isLocalVaultSupported()) return

    const context: LocalVaultRuntimeContext = {
      userId,
      persistence: 'device',
      stateVersion: localVaultStateVersion,
    }
    await enqueueLocalVaultOperation(() => saveRememberedLocalTaskQueue({
      schemaVersion: LOCAL_TASK_CACHE_SCHEMA_VERSION,
      userId,
      projectId: normalizedProjectId,
      taskQueue: taskQueueSnapshot,
      updatedAt: Date.now(),
    }))
    if (!isCurrentLocalVaultContext(get().runtime, context)) return
  },

  deleteLocalTaskQueue: async (projectId) => {
    const normalizedProjectId = projectId.trim()
    const state = get()
    const userId = state.runtime.vaultUserId

    if (!normalizedProjectId || !userId) return

    sessionTaskQueues.delete(getSessionTaskQueueKey(userId, normalizedProjectId))
    if (state.runtime.vaultPersistence !== 'device' || !isLocalVaultSupported()) return

    const context: LocalVaultRuntimeContext = {
      userId,
      persistence: 'device',
      stateVersion: localVaultStateVersion,
    }
    await enqueueLocalVaultOperation(() => deleteRememberedLocalTaskQueue(userId, normalizedProjectId))
    if (!isCurrentLocalVaultContext(get().runtime, context)) return
  },

  clearVaultSession: () => {
    advanceLocalVaultStateVersion()
    clearSessionTaskQueues()
    useTaskQueueStore.getState().clearDeviceCache()
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
          localModelBindings: Object.fromEntries(
            Object.entries(normalized.localModelBindings).filter(([, modelId]) => modelId !== deletedModel?.modelId),
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

  ensureLocalModelReference: (modelId) => {
    const normalizedModelId = modelId.trim()
    if (!normalizedModelId || isLocalModelReference(normalizedModelId)) return normalizedModelId

    const existing = findLocalModelReference(get().config.localModelBindings, normalizedModelId)
    if (existing) return existing

    const reference = createLocalModelReference(Object.keys(get().config.localModelBindings))
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        localModelBindings: {
          ...state.config.localModelBindings,
          [reference]: normalizedModelId,
        },
      }),
    }))
    return reference
  },

  bindLocalModelReference: (reference, modelId) => {
    const normalizedModelId = modelId.trim()
    if (!isLocalModelReference(reference) || !normalizedModelId || isLocalModelReference(normalizedModelId)) {
      return false
    }

    const modelExists = get().config.customModels.some((model) => model.enabled && model.modelId === normalizedModelId)
    if (!modelExists) return false

    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        localModelBindings: {
          ...state.config.localModelBindings,
          [reference]: normalizedModelId,
        },
      }),
    }))
    void get().persistLocalVault().catch(() => undefined)
    return true
  },

  resolveLocalModelReference: (reference) => (
    resolveLocalModelReference(get().config.localModelBindings, reference)
  ),

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
    }
  },
}))
