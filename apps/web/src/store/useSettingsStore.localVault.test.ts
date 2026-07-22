import { IDBFactory } from 'fake-indexeddb'
import { clearAuthenticatedRuntime } from '../features/auth/useAuthStore.ts'
import { loadRememberedLocalVault } from '../features/settings/localVault.ts'
import { useTaskQueueStore } from './useTaskQueueStore.ts'
import { useSettingsStore } from './useSettingsStore.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function resetStores() {
  useSettingsStore.setState(useSettingsStore.getInitialState())
  useTaskQueueStore.setState(useTaskQueueStore.getInitialState())
}

async function runLocalVaultStoreTests() {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const localStorage = new MemoryStorage()

  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://cloud.example' },
      localStorage,
    },
  })

  try {
    resetStores()
    const initialSource = await useSettingsStore.getState().hydrateLocalVault('user-a')
    assert(initialSource === 'empty', 'a fresh supported browser should create an empty device vault')
    assert(useSettingsStore.getState().runtime.vaultPersistence === 'device', 'device persistence should be the default')

    useSettingsStore.getState().saveProviderProfile({
      id: 'provider-a',
      name: 'Provider A',
      kind: 'image',
      apiKey: 'example-credential-a',
      apiUrl: 'https://provider.example/v1',
      provider: 'openai',
      requestMode: 'sync',
      asyncConfig: null,
      enabled: true,
      testStatus: 'idle',
      testMessage: '',
      lastTestedAt: null,
    })
    useSettingsStore.getState().saveCustomModel({
      id: 'model-entry',
      name: 'Image Model',
      modelId: 'model-a',
      kind: 'image',
      enabled: true,
      testStatus: 'idle',
      testMessage: '',
      lastTestedAt: null,
    })
    useSettingsStore.getState().setModelProviderProfile('model-a', 'provider-a')
    await useSettingsStore.getState().persistLocalVault()

    clearAuthenticatedRuntime()
    assert(useSettingsStore.getState().config.providerProfiles.length === 0, 'logout runtime clear should remove credential plaintext from memory')
    assert((await loadRememberedLocalVault('user-a'))?.providerProfiles.length === 1, 'logout runtime clear should preserve the remembered encrypted vault')

    const restoredSource = await useSettingsStore.getState().hydrateLocalVault('user-a')
    assert(restoredSource === 'device', 'the same user should restore the remembered device vault')
    assert(useSettingsStore.getState().config.modelProviderProfileIds['model-a'] === 'provider-a', 'model bindings should restore from the vault')

    await useSettingsStore.getState().setVaultPersistence('session')
    assert(await loadRememberedLocalVault('user-a') === null, 'session mode should remove the remembered record and CryptoKey')
    useSettingsStore.getState().saveProviderProfile({
      ...useSettingsStore.getState().config.providerProfiles[0],
      name: 'Session Only Provider',
    })
    await useSettingsStore.getState().persistLocalVault()
    assert(await loadRememberedLocalVault('user-a') === null, 'session mode must not write IndexedDB')
    useSettingsStore.getState().clearVaultSession()
    await useSettingsStore.getState().hydrateLocalVault('user-a')
    assert(useSettingsStore.getState().config.providerProfiles.length === 0, 'a new session must not restore session-only settings')

    useTaskQueueStore.getState().createTask({ sourceNodeId: 'node-a', model: 'model-a', prompt: 'test' })
    await useSettingsStore.getState().forgetDeviceVault()
    assert(useSettingsStore.getState().config.providerProfiles.length === 0, 'forget should clear in-memory provider profiles')
    assert(useTaskQueueStore.getState().tasks.length === 0, 'forget should clear the local task cache')
    assert(await loadRememberedLocalVault('user-a') === null, 'forget should delete the remembered device vault')

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() })
    localStorage.clear()
    localStorage.setItem('ai-canvas-settings', JSON.stringify({
      state: {
        config: {
          model: 'legacy-model',
          customModels: [{
            id: 'legacy-model-entry',
            name: 'Legacy Model',
            modelId: 'legacy-model',
            kind: 'image',
            enabled: true,
          }],
          providerProfiles: [{
            id: 'legacy-provider',
            name: 'Legacy Provider',
            kind: 'image',
            apiKey: 'legacy-example-credential',
            apiUrl: 'https://legacy.example/v1',
            provider: 'openai',
            requestMode: 'sync',
            enabled: true,
          }],
          activeProviderProfileIds: { image: 'legacy-provider' },
          modelProviderProfileIds: { 'legacy-model': 'legacy-provider' },
        },
      },
    }))
    resetStores()
    assert(await useSettingsStore.getState().hydrateLocalVault('user-a') === 'legacy', 'legacy plaintext should migrate once')
    assert(localStorage.getItem('ai-canvas-settings') === null, 'successful migration should remove the legacy plaintext cache')
    assert((await loadRememberedLocalVault('user-a'))?.providerProfiles[0]?.id === 'legacy-provider', 'legacy settings should be encrypted into the device vault')

    localStorage.setItem('ai-canvas-settings', JSON.stringify({ config: { model: 'keep-on-failure' } }))
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open: () => { throw new Error('blocked') } },
    })
    resetStores()
    await useSettingsStore.getState().hydrateLocalVault('user-b')
    assert(localStorage.getItem('ai-canvas-settings') !== null, 'failed migration must preserve the legacy plaintext for retry')
  } finally {
    if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    resetStores()
  }
}

await runLocalVaultStoreTests()
