import { IDBFactory } from 'fake-indexeddb'
import {
  createLocalVaultKey,
  decryptLocalTaskQueueDocument,
  decryptLocalVaultDocument,
  encryptLocalTaskQueueDocument,
  encryptLocalVaultDocument,
  forgetRememberedLocalVault,
  loadRememberedLocalTaskQueue,
  loadRememberedLocalVault,
  saveRememberedLocalTaskQueue,
  saveRememberedLocalVault,
  type LocalTaskQueueDocument,
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
      enabled: true,
      testStatus: 'idle',
      testMessage: '',
      lastTestedAt: null,
    }],
    activeProviderProfileIds: { image: 'provider-a' },
    modelProviderProfileIds: { 'model-a': 'provider-a' },
    localModelBindings: {
      'local:11111111-1111-4111-8111-111111111111': 'model-a',
    },
    updatedAt: 123,
  }
  const key = await createLocalVaultKey()
  assert(key.extractable === false, 'vault keys must be non-extractable')

  const encrypted = await encryptLocalVaultDocument(document, key, 'https://cloud.example')
  const serializedCiphertext = new TextDecoder().decode(encrypted.ciphertext)
  assert(!serializedCiphertext.includes('vault-plaintext-secret'), 'IndexedDB ciphertext must not contain the API key')

  const decrypted = await decryptLocalVaultDocument(encrypted, key, 'user-a', 'https://cloud.example')
  assert(decrypted.providerProfiles[0]?.apiKey === 'vault-plaintext-secret', 'the same origin and user should decrypt the vault')
  assert(decrypted.localModelBindings['local:11111111-1111-4111-8111-111111111111'] === 'model-a', 'anonymous Cloud model references should round-trip only inside the Vault')

  await assertRejects(
    decryptLocalVaultDocument(encrypted, key, 'user-b', 'https://cloud.example'),
    'a different user must not decrypt the vault',
  )
  await assertRejects(
    decryptLocalVaultDocument(encrypted, key, 'user-a', 'https://other.example'),
    'a different origin must not decrypt the vault',
  )

  const taskDocument: LocalTaskQueueDocument = {
    schemaVersion: 1,
    userId: 'user-a',
    projectId: 'project-a',
    taskQueue: {
      tasks: [{
        id: 'task-1',
        displayId: 'task-1',
        projectId: 'project-a',
        kind: 'video',
        sourceNodeId: 'video-generate-1',
        previewNodeId: 'video-1',
        model: 'private-video-model',
        prompt: 'private prompt',
        negativePrompt: '',
        ratio: '16:9',
        resolution: '720p',
        operationType: 'text-to-image',
        sourceImageNodeId: null,
        apiProfileId: 'private-profile',
        apiProfileName: 'Private Provider',
        provider: 'aliyun',
        referenceImageUrls: [],
        resultImageAsset: null,
        resultVideoAsset: null,
        status: 'running',
        errorMsg: '',
        remoteTaskId: 'private-remote-task',
        remoteStatus: 'IN_PROGRESS',
        createdAt: 100,
        startedAt: 101,
        finishedAt: null,
      }],
    },
    updatedAt: 200,
  }
  const encryptedTasks = await encryptLocalTaskQueueDocument(taskDocument, key, 'https://cloud.example')
  const serializedTaskCiphertext = new TextDecoder().decode(encryptedTasks.ciphertext)
  assert(!serializedTaskCiphertext.includes('private-remote-task'), 'task ciphertext must not expose remote task ids')
  assert(!serializedTaskCiphertext.includes('private-video-model'), 'task ciphertext must not expose model ids')
  assert((await decryptLocalTaskQueueDocument(encryptedTasks, key, 'user-a', 'project-a', 'https://cloud.example')).taskQueue.tasks[0]?.remoteTaskId === 'private-remote-task', 'same-device task cache should decrypt')
  await assertRejects(
    decryptLocalTaskQueueDocument(encryptedTasks, key, 'user-b', 'project-a', 'https://cloud.example'),
    'another user must not decrypt a task cache',
  )
  await assertRejects(
    decryptLocalTaskQueueDocument(encryptedTasks, key, 'user-a', 'project-b', 'https://cloud.example'),
    'another project must not decrypt a task cache',
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
    await saveRememberedLocalTaskQueue(taskDocument)
    const remembered = await loadRememberedLocalVault('user-a')
    assert(remembered?.providerProfiles[0]?.apiKey === document.providerProfiles[0]?.apiKey, 'device vault should round-trip through IndexedDB')
    assert(await loadRememberedLocalVault('user-b') === null, 'another user should not see the remembered vault record')
    assert((await loadRememberedLocalTaskQueue('user-a', 'project-a'))?.taskQueue.tasks[0]?.remoteTaskId === 'private-remote-task', 'same device should restore encrypted remote tasks')
    assert(await loadRememberedLocalTaskQueue('user-b', 'project-a') === null, 'another user should not see the task cache')
    assert(await loadRememberedLocalTaskQueue('user-a', 'project-b') === null, 'another project should not see the task cache')

    await forgetRememberedLocalVault('user-a')
    assert(await loadRememberedLocalVault('user-a') === null, 'forget should delete both the encrypted record and its key')
    assert(await loadRememberedLocalTaskQueue('user-a', 'project-a') === null, 'forget should delete every encrypted task cache owned by the user')

    const firstDevice = new IDBFactory()
    const secondDevice = new IDBFactory()
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: firstDevice })
    await saveRememberedLocalVault(document)
    await saveRememberedLocalTaskQueue(taskDocument)

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: secondDevice })
    assert(await loadRememberedLocalVault('user-a') === null, 'an independent browser device must not receive another device vault')
    assert(await loadRememberedLocalTaskQueue('user-a', 'project-a') === null, 'an independent browser device must not receive another device task cache')
    await saveRememberedLocalVault({
      ...document,
      defaultModelId: 'model-on-second-device',
      updatedAt: 456,
    })

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: firstDevice })
    assert((await loadRememberedLocalVault('user-a'))?.defaultModelId === 'model-a', 'the first device vault must remain independent')
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: secondDevice })
    assert((await loadRememberedLocalVault('user-a'))?.defaultModelId === 'model-on-second-device', 'the second device must keep only its local vault')

    const upgradedDevice = new IDBFactory()
    await createVersionOneVaultDatabase(upgradedDevice)
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: upgradedDevice })
    await saveRememberedLocalVault(document)
    await saveRememberedLocalTaskQueue(taskDocument)
    assert((await loadRememberedLocalTaskQueue('user-a', 'project-a'))?.taskQueue.tasks.length === 1, 'a version-one Vault database should upgrade with the encrypted task store intact')
  } finally {
    restoreGlobal('indexedDB', originalIndexedDb)
    restoreGlobal('window', originalWindow)
  }
}

function createVersionOneVaultDatabase(factory: IDBFactory) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open('ai-canvas-cloud-local-vault', 1)
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('vaults', { keyPath: 'id' })
      request.result.createObjectStore('keys')
    })
    request.addEventListener('success', () => {
      request.result.close()
      resolve()
    }, { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })
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
