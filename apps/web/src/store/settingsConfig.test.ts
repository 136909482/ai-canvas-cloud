import {
  fromWorkspaceConfigFile,
  normalizeConfig,
  normalizeStorageConfig,
  toWorkspaceConfigFile,
} from './settingsConfig.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function runSettingsConfigTests() {
  const emptyConfig = normalizeConfig()
  assert(emptyConfig.model === '', 'fresh config should not select a built-in model')
  assert(emptyConfig.customModels.length === 0, 'fresh config should not ship built-in models')
  assert(emptyConfig.providerProfiles.length === 0, 'fresh config should not ship provider profiles')

  const explicitEmptyConfig = normalizeConfig({
    model: '',
    customModels: [],
    providerProfiles: [],
  })
  assert(explicitEmptyConfig.customModels.length === 0, 'normalization should preserve an empty model library')
  assert(explicitEmptyConfig.providerProfiles.length === 0, 'normalization should preserve an empty provider library')

  const legacyConfig = normalizeConfig({
    apiKey: 'legacy-key',
    apiUrl: 'https://example.com/v1',
    model: 'legacy-image-model',
  })

  assert(legacyConfig.model === 'legacy-image-model', 'legacy model id should become the default model')
  assert(legacyConfig.customModels[0]?.modelId === 'legacy-image-model', 'legacy model should migrate into custom models')
  assert(legacyConfig.providerProfiles[0]?.apiKey === 'legacy-key', 'legacy API key should migrate into a provider profile')
  assert(legacyConfig.providerProfiles[0]?.provider === 'openai', 'legacy API URL should infer the provider family')

  const normalized = normalizeConfig({
    model: 'image-model',
    customModels: [{
      id: 'image-model-entry',
      name: ' Image Model ',
      modelId: 'image-model',
      kind: 'image',
      enabled: true,
      testStatus: 'success',
      testMessage: 'ok',
      lastTestedAt: 123,
    }],
    providerProfiles: [{
      id: 'image-provider',
      name: ' Image Provider ',
      kind: 'image',
      apiKey: 'secret',
      apiUrl: 'https://example.com/v1',
      provider: 'openai',
      requestMode: 'async',
      enabled: true,
      testStatus: 'success',
      testMessage: 'ok',
      lastTestedAt: 123,
    }],
    activeProviderProfileIds: { image: 'image-provider' },
    modelProviderProfileIds: {
      'image-model': 'image-provider',
      missing: 'image-provider',
    },
    localModelBindings: {
      'local:11111111-1111-4111-8111-111111111111': ' image-model ',
      'local:not-a-uuid': 'ignored-model',
    },
    storage: {
      autosaveIntervalMs: 1,
      canvasTopBarCollapsed: true,
      alignmentGuidesEnabled: false,
      themeMode: 'light',
      canvasPerformanceMode: 'performance',
      canvasGridEnabled: false,
      edgeStyle: 'solid',
      lowQualityPreviewEnabled: false,
      workspaceDirectoryName: ' workspace ',
      workspaceConfigured: true,
    },
  })

  assert(normalized.storage.autosaveIntervalMs === 15_000, 'autosave interval should respect the minimum')
  assert(normalized.storage.workspaceDirectoryName === 'workspace', 'workspace directory name should be trimmed')
  assert(!('missing' in normalized.modelProviderProfileIds), 'bindings for missing models should be removed')
  assert(normalized.localModelBindings['local:11111111-1111-4111-8111-111111111111'] === 'image-model', 'local model bindings should normalize inside private settings')
  assert(!('local:not-a-uuid' in normalized.localModelBindings), 'invalid local model references should be dropped')

  const legacyColorfulEdges = normalizeStorageConfig({ edgeStyle: 'colorful' })
  assert(legacyColorfulEdges.edgeStyle === 'step', 'legacy colorful edge style should migrate to step')

  const smoothStepEdges = normalizeStorageConfig({ edgeStyle: 'smoothstep' })
  assert(smoothStepEdges.edgeStyle === 'smoothstep', 'smoothstep edge style should be preserved')

  const workspaceConfig = toWorkspaceConfigFile(normalized)
  assert(workspaceConfig.customModels.length === 0, 'workspace config should not persist device-local models')
  assert(workspaceConfig.providerProfiles?.length === 0, 'cloud workspace config should not persist provider secrets')
  assert(!('localModelBindings' in workspaceConfig), 'cloud workspace config should not persist local model bindings')
  assert(!('workspaceConfigured' in workspaceConfig.storage), 'workspace config should omit runtime storage state')

  const restored = fromWorkspaceConfigFile(workspaceConfig)
  assert(restored?.customModels.length === 0, 'workspace config should restore without device-local models')
  assert(restored?.providerProfiles.length === 0, 'cloud workspace config should restore without browser provider profiles')
  assert(restored?.storage.workspaceConfigured === false, 'workspace runtime status should not hydrate from config files')
  assert(restored?.storage.workspaceDirectoryName === '', 'workspace directory name should come from runtime status')
}

runSettingsConfigTests()
