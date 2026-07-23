import {
  DEFAULT_ALIYUN_BASE_URL,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_IMAGE_MODEL_NAME,
  inferProviderFromApiUrl,
} from '../config/modelCatalog.ts'
import { normalizeLocalModelBindings } from '../features/settings/localModelReferences.ts'
import type {
  ApiConfig,
  CustomImageModelConfig,
  CustomModelKind,
  ProviderProfileConfig,
  StorageConfig,
  WorkspaceConfigFile,
} from '../types/index.ts'

interface LegacyProviderConfig {
  apiKey?: string
  apiUrl?: string
  model?: string
}

export interface LegacyConfigShape {
  apiKey?: string
  apiUrl?: string
  model?: string
  providers?: {
    aliyun?: LegacyProviderConfig
  }
}

function createModelId() {
  return `custom-model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createProviderProfileId() {
  return `provider-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createDefaultCustomModel(overrides?: Partial<CustomImageModelConfig>): CustomImageModelConfig {
  return {
    id: createModelId(),
    name: DEFAULT_IMAGE_MODEL_NAME,
    modelId: DEFAULT_IMAGE_MODEL_ID,
    kind: 'image',
    enabled: true,
    testStatus: 'idle',
    testMessage: '',
    lastTestedAt: null,
    ...overrides,
  }
}

export function normalizeCustomModel(model: Partial<CustomImageModelConfig>): CustomImageModelConfig {
  const fallback = createDefaultCustomModel()
  const modelId = model.modelId?.trim() || fallback.modelId

  return {
    ...fallback,
    ...model,
    id: model.id || fallback.id,
    name: model.name?.trim() || modelId || fallback.name,
    modelId,
    kind: model.kind ?? 'image',
    enabled: model.enabled ?? true,
    testStatus: model.testStatus ?? 'idle',
    testMessage: model.testMessage ?? '',
    lastTestedAt: model.lastTestedAt ?? null,
  }
}

export function createDefaultProviderProfile(overrides?: Partial<ProviderProfileConfig>): ProviderProfileConfig {
  const profile: ProviderProfileConfig = {
    id: createProviderProfileId(),
    name: '阿里百炼',
    kind: 'image',
    apiKey: '',
    apiUrl: DEFAULT_ALIYUN_BASE_URL,
    provider: 'aliyun',
    requestMode: 'sync',
    enabled: true,
    testStatus: 'idle',
    testMessage: '',
    lastTestedAt: null,
    ...overrides,
  }

  return profile
}

export function normalizeProviderProfile(profile: Partial<ProviderProfileConfig>): ProviderProfileConfig {
  const fallback = createDefaultProviderProfile()
  const apiUrl = profile.apiUrl?.trim() || fallback.apiUrl
  const provider = profile.provider ?? inferProviderFromApiUrl(apiUrl)

  return {
    ...fallback,
    ...profile,
    id: profile.id || fallback.id,
    name: profile.name?.trim() || (provider === 'aliyun' ? '阿里百炼' : 'OpenAI Compatible'),
    kind: profile.kind ?? 'image',
    apiKey: profile.apiKey ?? '',
    apiUrl,
    provider,
    requestMode: provider === 'openai' ? profile.requestMode ?? fallback.requestMode : 'sync',
    enabled: profile.enabled ?? true,
    testStatus: profile.testStatus ?? 'idle',
    testMessage: profile.testMessage ?? '',
    lastTestedAt: profile.lastTestedAt ?? null,
  }
}

function modelToMigratedProviderProfile(model: Partial<CustomImageModelConfig> & {
  apiKey?: string
  apiUrl?: string
  provider?: ProviderProfileConfig['provider']
  requestMode?: ProviderProfileConfig['requestMode']
}): ProviderProfileConfig {
  const apiUrl = model.apiUrl?.trim() || DEFAULT_ALIYUN_BASE_URL
  const provider = model.provider ?? inferProviderFromApiUrl(apiUrl)

  return normalizeProviderProfile({
    id: `provider-${model.id || createProviderProfileId()}`,
    name: model.name?.trim() || (provider === 'aliyun' ? '阿里百炼' : 'OpenAI Compatible'),
    kind: model.kind ?? 'image',
    apiKey: model.apiKey ?? '',
    apiUrl,
    provider,
    requestMode: model.requestMode ?? 'sync',
    enabled: model.enabled ?? true,
  })
}

function migrateLegacyModels(config?: LegacyConfigShape): CustomImageModelConfig[] {
  const aliyunConfig = config?.providers?.aliyun
  const modelId = aliyunConfig?.model ?? config?.model ?? DEFAULT_IMAGE_MODEL_ID

  if (!modelId.trim()) {
    return []
  }

  return [
    normalizeCustomModel({
      id: 'default-aliyun-model',
      name: modelId,
      modelId,
      kind: 'image',
      enabled: true,
    }),
  ]
}

function migrateLegacyProviderProfiles(config?: LegacyConfigShape): ProviderProfileConfig[] {
  const aliyunConfig = config?.providers?.aliyun

  if (!aliyunConfig && !config?.apiKey?.trim() && !config?.apiUrl?.trim()) {
    return []
  }

  const apiKey = aliyunConfig?.apiKey ?? config?.apiKey ?? ''
  const apiUrl = aliyunConfig?.apiUrl ?? config?.apiUrl ?? DEFAULT_ALIYUN_BASE_URL

  return [
    normalizeProviderProfile({
      id: 'default-aliyun-provider',
      name: inferProviderFromApiUrl(apiUrl) === 'aliyun' ? '阿里百炼' : 'OpenAI Compatible',
      kind: 'image',
      apiKey,
      apiUrl,
      provider: inferProviderFromApiUrl(apiUrl),
      requestMode: 'sync',
      enabled: true,
    }),
  ]
}

export function normalizeStorageConfig(config?: Partial<StorageConfig>): StorageConfig {
  const autosaveIntervalMs = Number.isFinite(config?.autosaveIntervalMs)
    ? Math.max(15_000, Number(config?.autosaveIntervalMs))
    : 60_000
  const themeMode = config?.themeMode === 'light' || config?.themeMode === 'system'
    ? config.themeMode
    : 'dark'
  const canvasPerformanceMode = config?.canvasPerformanceMode === 'performance' ? 'performance' : 'quality'
  const edgeStyle = config?.edgeStyle === 'solid'
    || config?.edgeStyle === 'step'
    || config?.edgeStyle === 'smoothstep'
    ? config.edgeStyle
    : config?.edgeStyle === 'colorful'
      ? 'step'
      : 'animated'

  return {
    autosaveIntervalMs,
    canvasTopBarCollapsed: Boolean(config?.canvasTopBarCollapsed),
    alignmentGuidesEnabled: config?.alignmentGuidesEnabled !== false,
    themeMode,
    canvasPerformanceMode,
    canvasGridEnabled: config?.canvasGridEnabled !== false,
    edgeStyle,
    lowQualityPreviewEnabled: config?.lowQualityPreviewEnabled !== false,
    workspaceDirectoryName: config?.workspaceDirectoryName?.trim() ?? '',
    workspaceConfigured: Boolean(config?.workspaceConfigured),
  }
}

export function normalizeConfig(config?: Partial<ApiConfig> | LegacyConfigShape): ApiConfig {
  const maybeCustomModels = (config as Partial<ApiConfig> | undefined)?.customModels
  const customModels = Array.isArray(maybeCustomModels)
    ? maybeCustomModels.map((model) => normalizeCustomModel(model))
    : migrateLegacyModels(config as LegacyConfigShape | undefined)

  const maybeProviderProfiles = (config as Partial<ApiConfig> | undefined)?.providerProfiles
  const providerProfiles = Array.isArray(maybeProviderProfiles)
    ? maybeProviderProfiles.map((profile) => normalizeProviderProfile(profile))
    : Array.isArray(maybeCustomModels) && maybeCustomModels.length > 0
      ? maybeCustomModels.map((model) => modelToMigratedProviderProfile(model))
      : migrateLegacyProviderProfiles(config as LegacyConfigShape | undefined)

  const enabledModels = customModels.filter((model) => model.enabled)
  const enabledProfiles = providerProfiles.filter((profile) => profile.enabled)
  const defaultModel = (config as Partial<ApiConfig> | undefined)?.model
  const hasDefaultModel = enabledModels.some((model) => model.modelId === defaultModel)
  const rawActiveProviderProfileIds = (config as Partial<ApiConfig> | undefined)?.activeProviderProfileIds ?? {}
  const rawModelProviderProfileIds = (config as Partial<ApiConfig> | undefined)?.modelProviderProfileIds ?? {}
  const localModelBindings = normalizeLocalModelBindings((config as Partial<ApiConfig> | undefined)?.localModelBindings)
  const activeProviderProfileIds = Object.fromEntries(
    (['chat', 'image', 'video', 'music', 'tool'] as CustomModelKind[]).map((kind) => {
      const configuredId = rawActiveProviderProfileIds[kind]
      const activeId = enabledProfiles.some((profile) => profile.id === configuredId && profile.kind === kind)
        ? configuredId
        : enabledProfiles.find((profile) => profile.kind === kind)?.id

      return [kind, activeId]
    }).filter((entry): entry is [CustomModelKind, string] => typeof entry[1] === 'string' && entry[1].length > 0),
  ) as Partial<Record<CustomModelKind, string>>
  const modelKindByModelId = new Map(customModels.map((model) => [model.modelId, model.kind]))
  const modelProviderProfileIds = Object.fromEntries(
    Object.entries(rawModelProviderProfileIds)
      .filter((entry): entry is [string, string] => (
        typeof entry[0] === 'string'
        && entry[0].trim().length > 0
        && typeof entry[1] === 'string'
        && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(entry[1])
        && modelKindByModelId.has(entry[0])
      )),
  )

  return {
    model: hasDefaultModel ? defaultModel ?? enabledModels[0]?.modelId ?? '' : enabledModels[0]?.modelId ?? '',
    customModels,
    providerProfiles,
    activeProviderProfileIds,
    modelProviderProfileIds,
    localModelBindings,
    storage: normalizeStorageConfig((config as Partial<ApiConfig> | undefined)?.storage),
  }
}

export function toWorkspaceConfigFile(config: ApiConfig): WorkspaceConfigFile {
  const normalized = normalizeConfig(config)

  return {
    version: 1,
    model: '',
    customModels: [],
    providerProfiles: [],
    activeProviderProfileIds: {},
    modelProviderProfileIds: {},
    storage: {
      autosaveIntervalMs: normalized.storage.autosaveIntervalMs,
      canvasTopBarCollapsed: normalized.storage.canvasTopBarCollapsed,
      alignmentGuidesEnabled: normalized.storage.alignmentGuidesEnabled,
      themeMode: normalized.storage.themeMode,
      canvasPerformanceMode: normalized.storage.canvasPerformanceMode,
      canvasGridEnabled: normalized.storage.canvasGridEnabled,
      lowQualityPreviewEnabled: normalized.storage.lowQualityPreviewEnabled,
      edgeStyle: normalized.storage.edgeStyle,
    },
  }
}

export function fromWorkspaceConfigFile(configFile: WorkspaceConfigFile | null | undefined): ApiConfig | null {
  if (!configFile) {
    return null
  }

  return normalizeConfig({
    model: '',
    customModels: [],
    providerProfiles: [],
    activeProviderProfileIds: {},
    modelProviderProfileIds: {},
    localModelBindings: {},
    storage: {
      autosaveIntervalMs: configFile.storage?.autosaveIntervalMs,
      canvasTopBarCollapsed: configFile.storage?.canvasTopBarCollapsed,
      alignmentGuidesEnabled: configFile.storage?.alignmentGuidesEnabled,
      themeMode: configFile.storage?.themeMode,
      canvasPerformanceMode: configFile.storage?.canvasPerformanceMode,
      canvasGridEnabled: configFile.storage?.canvasGridEnabled,
      lowQualityPreviewEnabled: configFile.storage?.lowQualityPreviewEnabled,
      edgeStyle: configFile.storage?.edgeStyle,
      workspaceConfigured: false,
      workspaceDirectoryName: '',
    },
  })
}
