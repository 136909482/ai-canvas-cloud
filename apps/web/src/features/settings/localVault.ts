import type {
  CustomImageModelConfig,
  CustomModelKind,
  ProviderProfileConfig,
} from '@/types'

export const LOCAL_VAULT_SCHEMA_VERSION = 1
export const LOCAL_VAULT_CIPHER_VERSION = 1

const DATABASE_NAME = 'ai-canvas-cloud-local-vault'
const DATABASE_VERSION = 1
const VAULT_STORE = 'vaults'
const KEY_STORE = 'keys'
const AAD_NAMESPACE = 'ai-canvas-cloud:local-vault'

export type LocalVaultPersistence = 'session' | 'device'

export interface LocalVaultDocument {
  schemaVersion: typeof LOCAL_VAULT_SCHEMA_VERSION
  userId: string
  defaultModelId: string
  customModels: CustomImageModelConfig[]
  providerProfiles: ProviderProfileConfig[]
  activeProviderProfileIds: Partial<Record<CustomModelKind, string>>
  modelProviderProfileIds: Record<string, string>
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

function createAdditionalData(origin: string, userId: string) {
  return new TextEncoder().encode([
    AAD_NAMESPACE,
    `cipher=${LOCAL_VAULT_CIPHER_VERSION}`,
    `schema=${LOCAL_VAULT_SCHEMA_VERSION}`,
    `origin=${origin}`,
    `user=${userId}`,
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
    if (!record || !key) throw new Error('本地密钥 Vault 记录不完整，请忘记此设备后重新配置')

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

export async function forgetRememberedLocalVault(userId: string) {
  const id = getRecordId(userId)
  const database = await openLocalVaultDatabase()

  try {
    const transaction = database.transaction([VAULT_STORE, KEY_STORE], 'readwrite')
    transaction.objectStore(VAULT_STORE).delete(id)
    transaction.objectStore(KEY_STORE).delete(id)
    await transactionToPromise(transaction)
  } finally {
    database.close()
  }
}
