import { IDBFactory } from 'fake-indexeddb'
import {
  createLocalVaultKey,
  decryptLocalVaultDocument,
  encryptLocalVaultDocument,
  forgetRememberedLocalVault,
  loadRememberedLocalVault,
  saveRememberedLocalVault,
  type LocalVaultDocument,
} from './localVault.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function runLocalVaultTests() {
  const document: LocalVaultDocument = {
    schemaVersion: 1,
    userId: 'user-a',
    defaultModelId: 'model-a',
    customModels: [{
      id: 'model-entry',
      name: 'Model A',
      modelId: 'model-a',
      kind: 'image',
      enabled: true,
      testStatus: 'idle',
      testMessage: '',
      lastTestedAt: null,
    }],
    providerProfiles: [{
      id: 'provider-a',
      name: 'Provider A',
      kind: 'image',
      apiKey: 'vault-plaintext-secret',
      apiUrl: 'https://provider.example/v1',
      provider: 'openai',
      requestMode: 'sync',
      asyncConfig: null,
      enabled: true,
      testStatus: 'idle',
      testMessage: '',
      lastTestedAt: null,
    }],
    activeProviderProfileIds: { image: 'provider-a' },
    modelProviderProfileIds: { 'model-a': 'provider-a' },
    updatedAt: 123,
  }
  const key = await createLocalVaultKey()
  assert(key.extractable === false, 'vault keys must be non-extractable')

  const encrypted = await encryptLocalVaultDocument(document, key, 'https://cloud.example')
  const serializedCiphertext = new TextDecoder().decode(encrypted.ciphertext)
  assert(!serializedCiphertext.includes('vault-plaintext-secret'), 'IndexedDB ciphertext must not contain the API key')

  const decrypted = await decryptLocalVaultDocument(encrypted, key, 'user-a', 'https://cloud.example')
  assert(decrypted.providerProfiles[0]?.apiKey === 'vault-plaintext-secret', 'the same origin and user should decrypt the vault')

  await assertRejects(
    decryptLocalVaultDocument(encrypted, key, 'user-b', 'https://cloud.example'),
    'a different user must not decrypt the vault',
  )
  await assertRejects(
    decryptLocalVaultDocument(encrypted, key, 'user-a', 'https://other.example'),
    'a different origin must not decrypt the vault',
  )

  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://cloud.example' } },
  })

  try {
    await saveRememberedLocalVault(document)
    const remembered = await loadRememberedLocalVault('user-a')
    assert(remembered?.providerProfiles[0]?.apiKey === document.providerProfiles[0]?.apiKey, 'device vault should round-trip through IndexedDB')
    assert(await loadRememberedLocalVault('user-b') === null, 'another user should not see the remembered vault record')

    await forgetRememberedLocalVault('user-a')
    assert(await loadRememberedLocalVault('user-a') === null, 'forget should delete both the encrypted record and its key')
  } finally {
    restoreGlobal('indexedDB', originalIndexedDb)
    restoreGlobal('window', originalWindow)
  }
}

function restoreGlobal(name: 'indexedDB' | 'window', descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor)
  } else {
    Reflect.deleteProperty(globalThis, name)
  }
}

async function assertRejects(promise: Promise<unknown>, message: string) {
  try {
    await promise
  } catch {
    return
  }
  throw new Error(message)
}

await runLocalVaultTests()
