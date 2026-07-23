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

function delayVaultEncryption() {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const cryptoApi = globalThis.crypto
  let markEncryptionStarted!: () => void
  let releaseEncryption!: () => void
  const encryptionStarted = new Promise<void>((resolve) => {
    markEncryptionStarted = resolve
  })
  const encryptionGate = new Promise<void>((resolve) => {
    releaseEncryption = resolve
  })
  const delayedSubtle = new Proxy(cryptoApi.subtle, {
    get(target, property) {
      if (property === 'encrypt') {
        return async (...args: Parameters<SubtleCrypto['encrypt']>) => {
          markEncryptionStarted()
          await encryptionGate
          return target.encrypt(...args)
        }
      }

      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: cryptoApi.getRandomValues.bind(cryptoApi),
      subtle: delayedSubtle,
    } as Crypto,
  })

  return {
    encryptionStarted,
    releaseEncryption,
    restore() {
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
      else Reflect.deleteProperty(globalThis, 'crypto')
    },
  }
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

    useSettingsStore.getState().saveProviderProfile({
      id: 'stale-provider',
      name: 'Stale Provider',
      kind: 'image',
      apiKey: 'stale-example-credential',
      apiUrl: 'https://stale.example/v1',
      provider: 'openai',
      requestMode: 'sync',
      enabled: true,
      testStatus: 'idle',
      testMessage: '',
      lastTestedAt: null,
    })
    await useSettingsStore.getState().persistLocalVault()

    const delayedStaleSave = delayVaultEncryption()
    const pendingStaleSave = useSettingsStore.getState().persistLocalVault()
    await delayedStaleSave.encryptionStarted
    useSettingsStore.getState().clearVaultSession()
    useSettingsStore.setState((state) => ({
      runtime: {
        ...state.runtime,
        vaultStatus: 'ready',
        vaultPersistence: 'session',
        vaultUserId: 'user-b',
        vaultUpdatedAt: null,
      },
    }))
    delayedStaleSave.releaseEncryption()
    await pendingStaleSave
    delayedStaleSave.restore()
    assert(useSettingsStore.getState().runtime.vaultUserId === 'user-b', 'a stale save must not replace the current trusted user')
    assert(useSettingsStore.getState().runtime.vaultPersistence === 'session', 'a stale save must not replace the current persistence mode')
    assert(useSettingsStore.getState().runtime.vaultUpdatedAt === null, 'a stale save must not publish its timestamp into a newer session')

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
