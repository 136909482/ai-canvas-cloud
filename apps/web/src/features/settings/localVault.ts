import type {
  CustomImageModelConfig,
  CustomModelKind,
  ProviderProfileConfig,
  TaskQueueSnapshot,
} from '@/types'
import { normalizeLocalModelBindings } from './localModelReferences.ts'

export const LOCAL_VAULT_SCHEMA_VERSION = 1
export const LOCAL_VAULT_CIPHER_VERSION = 1
export const LOCAL_TASK_CACHE_SCHEMA_VERSION = 1

const DATABASE_NAME = 'ai-canvas-cloud-local-vault'
const DATABASE_VERSION = 2
const VAULT_STORE = 'vaults'
const KEY_STORE = 'keys'
const TASK_STORE = 'taskQueues'
const TASK_OWNER_INDEX = 'ownerId'
const AAD_NAMESPACE = 'ai-canvas-cloud:local-vault'
const TASK_AAD_NAMESPACE = 'ai-canvas-cloud:local-task-cache'

export type LocalVaultPersistence = 'session' | 'device'

export interface LocalVaultDocument {
  schemaVersion: typeof LOCAL_VAULT_SCHEMA_VERSION
  userId: string
  defaultModelId: string
  customModels: CustomImageModelConfig[]
  providerProfiles: ProviderProfileConfig[]
  activeProviderProfileIds: Partial<Record<CustomModelKind, string>>
  modelProviderProfileIds: Record<string, string>
  localModelBindings: Record<string, string>
  updatedAt: number
}

interface EncryptedLocalVaultRecord {
  id: string
  cipherVersion: typeof LOCAL_VAULT_CIPHER_VERSION
  schemaVersion: typeof LOCAL_VAULT_SCHEMA_VERSION
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

export interface LocalTaskQueueDocument {
  schemaVersion: typeof LOCAL_TASK_CACHE_SCHEMA_VERSION
  userId: string
  projectId: string
  taskQueue: TaskQueueSnapshot
  updatedAt: number
}

interface EncryptedLocalTaskQueueRecord {
  id: string
  ownerId: string
  cipherVersion: typeof LOCAL_VAULT_CIPHER_VERSION
  schemaVersion: typeof LOCAL_TASK_CACHE_SCHEMA_VERSION
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
  updatedAt: number
}

function getCrypto() {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle) throw new Error('当前浏览器不支持 WebCrypto，无法启用本地密钥 Vault')
  return cryptoApi
}

function getOrigin() {
  if (typeof window === 'undefined') return 'https://test.invalid'
  return window.location.origin
}

function getRecordId(userId: string) {
  const normalized = userId.trim()
  if (!normalized) throw new Error('本地密钥 Vault 缺少登录用户 ID')
  return `user:${normalized}`
}

function getTaskRecordId(userId: string, projectId: string) {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) throw new Error('本地任务缓存缺少项目 ID')
  return `${getRecordId(userId)}:project:${normalizedProjectId}`
}

function createAdditionalData(origin: string, userId: string) {
  return new TextEncoder().encode([
    AAD_NAMESPACE,
    `cipher=${LOCAL_VAULT_CIPHER_VERSION}`,
    `schema=${LOCAL_VAULT_SCHEMA_VERSION}`,
    `origin=${origin}`,
    `user=${userId}`,
  ].join('\n'))
}

function createTaskAdditionalData(origin: string, userId: string, projectId: string) {
  return new TextEncoder().encode([
    TASK_AAD_NAMESPACE,
    `cipher=${LOCAL_VAULT_CIPHER_VERSION}`,
    `schema=${LOCAL_TASK_CACHE_SCHEMA_VERSION}`,
    `origin=${origin}`,
    `user=${userId}`,
    `project=${projectId}`,
  ].join('\n'))
}

export async function createLocalVaultKey() {
  return getCrypto().subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptLocalVaultDocument(
  document: LocalVaultDocument,
  key: CryptoKey,
  origin = getOrigin(),
): Promise<EncryptedLocalVaultRecord> {
  const cryptoApi = getCrypto()
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(document))
  const ciphertext = await cryptoApi.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: createAdditionalData(origin, document.userId),
    tagLength: 128,
  }, key, plaintext)

  return {
    id: getRecordId(document.userId),
    cipherVersion: LOCAL_VAULT_CIPHER_VERSION,
    schemaVersion: LOCAL_VAULT_SCHEMA_VERSION,
    iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
    ciphertext,
    updatedAt: document.updatedAt,
  }
}

function isLocalVaultDocument(value: unknown): value is LocalVaultDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const document = value as Partial<LocalVaultDocument>
  return document.schemaVersion === LOCAL_VAULT_SCHEMA_VERSION
    && typeof document.userId === 'string'
    && typeof document.defaultModelId === 'string'
    && Array.isArray(document.customModels)
    && Array.isArray(document.providerProfiles)
    && Boolean(document.activeProviderProfileIds && typeof document.activeProviderProfileIds === 'object')
    && Boolean(document.modelProviderProfileIds && typeof document.modelProviderProfileIds === 'object')
    && typeof document.updatedAt === 'number'
}

export async function decryptLocalVaultDocument(
  record: EncryptedLocalVaultRecord,
  key: CryptoKey,
  userId: string,
  origin = getOrigin(),
): Promise<LocalVaultDocument> {
  if (record.cipherVersion !== LOCAL_VAULT_CIPHER_VERSION || record.schemaVersion !== LOCAL_VAULT_SCHEMA_VERSION) {
    throw new Error('本地密钥 Vault 版本不受支持')
  }

  const plaintext = await getCrypto().subtle.decrypt({
    name: 'AES-GCM',
    iv: record.iv,
    additionalData: createAdditionalData(origin, userId),
    tagLength: 128,
  }, key, record.ciphertext)
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown

  if (!isLocalVaultDocument(parsed) || parsed.userId !== userId) {
    throw new Error('本地密钥 Vault 内容无效')
  }

  return {
    ...parsed,
    localModelBindings: normalizeLocalModelBindings(parsed.localModelBindings),
  }
}

export async function encryptLocalTaskQueueDocument(
  document: LocalTaskQueueDocument,
  key: CryptoKey,
  origin = getOrigin(),
): Promise<EncryptedLocalTaskQueueRecord> {
  const cryptoApi = getCrypto()
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(document))
  const ciphertext = await cryptoApi.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: createTaskAdditionalData(origin, document.userId, document.projectId),
    tagLength: 128,
  }, key, plaintext)

  return {
    id: getTaskRecordId(document.userId, document.projectId),
    ownerId: getRecordId(document.userId),
    cipherVersion: LOCAL_VAULT_CIPHER_VERSION,
    schemaVersion: LOCAL_TASK_CACHE_SCHEMA_VERSION,
    iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
    ciphertext,
    updatedAt: document.updatedAt,
  }
}

function isLocalTaskQueueDocument(value: unknown): value is LocalTaskQueueDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const document = value as Partial<LocalTaskQueueDocument>
  return document.schemaVersion === LOCAL_TASK_CACHE_SCHEMA_VERSION
    && typeof document.userId === 'string'
    && typeof document.projectId === 'string'
    && Boolean(document.taskQueue && typeof document.taskQueue === 'object')
    && Array.isArray(document.taskQueue?.tasks)
    && typeof document.updatedAt === 'number'
}

export async function decryptLocalTaskQueueDocument(
  record: EncryptedLocalTaskQueueRecord,
  key: CryptoKey,
  userId: string,
  projectId: string,
  origin = getOrigin(),
): Promise<LocalTaskQueueDocument> {
  if (record.cipherVersion !== LOCAL_VAULT_CIPHER_VERSION || record.schemaVersion !== LOCAL_TASK_CACHE_SCHEMA_VERSION) {
    throw new Error('本地任务缓存版本不受支持')
  }

  const plaintext = await getCrypto().subtle.decrypt({
    name: 'AES-GCM',
    iv: record.iv,
    additionalData: createTaskAdditionalData(origin, userId, projectId),
    tagLength: 128,
  }, key, record.ciphertext)
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown

  if (!isLocalTaskQueueDocument(parsed) || parsed.userId !== userId || parsed.projectId !== projectId) {
    throw new Error('本地任务缓存内容无效')
  }

  return parsed
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB 请求失败')), { once: true })
  })
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB 事务已中止')), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB 事务失败')), { once: true })
  })
}

function openLocalVaultDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持 IndexedDB，无法记住此设备'))
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      if (!database.objectStoreNames.contains(VAULT_STORE)) database.createObjectStore(VAULT_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE)
      if (!database.objectStoreNames.contains(TASK_STORE)) {
        const taskStore = database.createObjectStore(TASK_STORE, { keyPath: 'id' })
        taskStore.createIndex(TASK_OWNER_INDEX, 'ownerId', { unique: false })
      }
    })
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('无法打开本地密钥 Vault')), { once: true })
    request.addEventListener('blocked', () => reject(new Error('本地密钥 Vault 升级被其他页面阻塞')), { once: true })
  })
}

export function isLocalVaultSupported() {
  return typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle)
}

export async function loadRememberedLocalVault(userId: string) {
  const id = getRecordId(userId)
  const database = await openLocalVaultDatabase()

  try {
    const transaction = database.transaction([VAULT_STORE, KEY_STORE], 'readonly')
    const [record, key] = await Promise.all([
      requestToPromise(transaction.objectStore(VAULT_STORE).get(id)) as Promise<EncryptedLocalVaultRecord | undefined>,
      requestToPromise(transaction.objectStore(KEY_STORE).get(id)) as Promise<CryptoKey | undefined>,
    ])
    await transactionToPromise(transaction)

    if (!record && !key) return null
    if (!record || !key) throw new Error('本地密钥 Vault 记录不完整，请清除当前网站数据后重新配置')

    return decryptLocalVaultDocument(record, key, userId)
  } finally {
    database.close()
  }
}

export async function saveRememberedLocalVault(document: LocalVaultDocument) {
  const id = getRecordId(document.userId)
  const database = await openLocalVaultDatabase()

  try {
    const keyTransaction = database.transaction(KEY_STORE, 'readonly')
    let key = await requestToPromise(keyTransaction.objectStore(KEY_STORE).get(id)) as CryptoKey | undefined
    await transactionToPromise(keyTransaction)
    key ??= await createLocalVaultKey()

    const record = await encryptLocalVaultDocument(document, key)
    const transaction = database.transaction([VAULT_STORE, KEY_STORE], 'readwrite')
    transaction.objectStore(KEY_STORE).put(key, id)
    transaction.objectStore(VAULT_STORE).put(record)
    await transactionToPromise(transaction)
  } finally {
    database.close()
  }
}

export async function loadRememberedLocalTaskQueue(userId: string, projectId: string) {
  const id = getTaskRecordId(userId, projectId)
  const keyId = getRecordId(userId)
  const database = await openLocalVaultDatabase()

  try {
    const transaction = database.transaction([TASK_STORE, KEY_STORE], 'readonly')
    const [record, key] = await Promise.all([
      requestToPromise(transaction.objectStore(TASK_STORE).get(id)) as Promise<EncryptedLocalTaskQueueRecord | undefined>,
      requestToPromise(transaction.objectStore(KEY_STORE).get(keyId)) as Promise<CryptoKey | undefined>,
    ])
    await transactionToPromise(transaction)

    if (!record) return null
    if (!key) throw new Error('本地任务缓存缺少设备密钥，请清除当前网站数据后重新配置')
    return decryptLocalTaskQueueDocument(record, key, userId, projectId)
  } finally {
    database.close()
  }
}

export async function saveRememberedLocalTaskQueue(document: LocalTaskQueueDocument) {
  const keyId = getRecordId(document.userId)
  const database = await openLocalVaultDatabase()

  try {
    const keyTransaction = database.transaction(KEY_STORE, 'readonly')
    const key = await requestToPromise(keyTransaction.objectStore(KEY_STORE).get(keyId)) as CryptoKey | undefined
    await transactionToPromise(keyTransaction)
    if (!key) throw new Error('本地任务缓存缺少设备密钥')

    const record = await encryptLocalTaskQueueDocument(document, key)
    const transaction = database.transaction(TASK_STORE, 'readwrite')
    transaction.objectStore(TASK_STORE).put(record)
    await transactionToPromise(transaction)
  } finally {
    database.close()
  }
}

export async function deleteRememberedLocalTaskQueue(userId: string, projectId: string) {
  const database = await openLocalVaultDatabase()

  try {
    const transaction = database.transaction(TASK_STORE, 'readwrite')
    transaction.objectStore(TASK_STORE).delete(getTaskRecordId(userId, projectId))
    await transactionToPromise(transaction)
  } finally {
    database.close()
  }
}

function deleteTaskQueuesForOwner(store: IDBObjectStore, ownerId: string) {
  return new Promise<void>((resolve, reject) => {
    const request = store.index(TASK_OWNER_INDEX).openKeyCursor(ownerId)
    request.addEventListener('error', () => reject(request.error ?? new Error('删除本地任务缓存失败')), { once: true })
    request.addEventListener('success', () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      store.delete(cursor.primaryKey)
      cursor.continue()
    })
  })
}

export async function forgetRememberedLocalVault(userId: string) {
  const id = getRecordId(userId)
  const database = await openLocalVaultDatabase()

  try {
    const transaction = database.transaction([VAULT_STORE, KEY_STORE, TASK_STORE], 'readwrite')
    transaction.objectStore(VAULT_STORE).delete(id)
    transaction.objectStore(KEY_STORE).delete(id)
    await deleteTaskQueuesForOwner(transaction.objectStore(TASK_STORE), id)
    await transactionToPromise(transaction)
  } finally {
    database.close()
  }
}
