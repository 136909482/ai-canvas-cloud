import type { WorkspaceConfigFile } from '@/types'

export function redactWorkspaceConfigSecrets(config: WorkspaceConfigFile): WorkspaceConfigFile {
  return {
    ...config,
    model: '',
    customModels: [],
    providerProfiles: [],
    activeProviderProfileIds: {},
    modelProviderProfileIds: {},
  }
}

export function redactWorkspaceConfigSecretsForCache(config: WorkspaceConfigFile) {
  return redactWorkspaceConfigSecrets(config)
}

export function hasWorkspaceConfigSecrets(config: WorkspaceConfigFile | null | undefined) {
  return Boolean(
    config?.model
    || config?.customModels.length
    || config?.providerProfiles?.length
    || Object.keys(config?.activeProviderProfileIds ?? {}).length
    || Object.keys(config?.modelProviderProfileIds ?? {}).length,
  )
}
