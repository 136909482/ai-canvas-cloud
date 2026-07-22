import {
  hasWorkspaceConfigSecrets,
  redactWorkspaceConfigSecrets,
  redactWorkspaceConfigSecretsForCache,
} from './providerSecrets.ts'
import type { WorkspaceConfigFile } from '@/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function createWorkspaceConfig(): WorkspaceConfigFile {
  return {
    version: 1,
    model: 'image-model',
    customModels: [
      {
        id: 'model-1',
        name: 'Image Model',
        modelId: 'image-model',
        kind: 'image',
        enabled: true,
      },
    ],
    providerProfiles: [
      {
        id: 'provider-1',
        name: 'Provider',
        kind: 'image',
        apiKey: 'sk-secret',
        apiUrl: 'https://example.com/v1',
        provider: 'openai',
        requestMode: 'sync',
        asyncConfig: null,
        enabled: true,
      },
    ],
    activeProviderProfileIds: { image: 'provider-1' },
    modelProviderProfileIds: { 'image-model': 'provider-1' },
    storage: {
      autosaveIntervalMs: 60_000,
      canvasTopBarCollapsed: false,
      alignmentGuidesEnabled: true,
      themeMode: 'dark',
      canvasPerformanceMode: 'quality',
      canvasGridEnabled: true,
      lowQualityPreviewEnabled: true,
      edgeStyle: 'animated',
    },
  }
}

function runProviderSecretTests() {
  const config = createWorkspaceConfig()
  const redacted = redactWorkspaceConfigSecretsForCache(config)
  const exportSafe = redactWorkspaceConfigSecrets(config)

  assert(hasWorkspaceConfigSecrets(config), 'workspace config should be able to detect stored provider secrets')
  assert(!hasWorkspaceConfigSecrets(redacted), 'redacted workspace config cache should not contain private provider or model settings')
  assert(redacted.model === '', 'workspace caches must omit the real default model id')
  assert(redacted.customModels.length === 0, 'workspace caches must omit local models')
  assert(redacted.providerProfiles?.length === 0, 'workspace caches must omit provider profiles and endpoints')
  assert(config.providerProfiles?.[0].apiKey === 'sk-secret', 'redacting cache config should not mutate the original workspace config')
  assert(exportSafe.providerProfiles?.length === 0, 'workspace exports must omit all provider settings')
  assert(config.providerProfiles?.[0].apiKey === 'sk-secret', 'export redaction must not mutate source config')
  assert(
    JSON.stringify(exportSafe) === JSON.stringify(redacted),
    'cache and export redaction must share one policy',
  )
}

runProviderSecretTests()
