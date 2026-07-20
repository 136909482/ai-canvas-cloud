import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'

export interface ProviderCredentialEnvelope {
  algorithm: typeof ALGORITHM
  keyVersion: number
  iv: string
  ciphertext: string
  authTag: string
}

export interface ProviderCredentialKeyring {
  activeVersion: number
  keys: ReadonlyMap<number, Buffer>
}

function decodeKey(value: string) {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength !== 32 || decoded.toString('base64') !== value) {
    throw new Error('Provider credential keys must be canonical base64-encoded 32-byte values')
  }
  return decoded
}

export function parseProviderCredentialKeyring(serialized: string, activeVersion: number): ProviderCredentialKeyring {
  if (!Number.isInteger(activeVersion) || activeVersion < 1) {
    throw new Error('Provider credential active key version must be a positive integer')
  }
  const keys = new Map<number, Buffer>()
  for (const entry of serialized.split(',')) {
    const separator = entry.indexOf(':')
    const version = Number(entry.slice(0, separator))
    const encodedKey = entry.slice(separator + 1)
    if (separator < 1 || !Number.isInteger(version) || version < 1 || !encodedKey || keys.has(version)) {
      throw new Error('Provider credential keyring is invalid')
    }
    keys.set(version, decodeKey(encodedKey))
  }
  if (!keys.has(activeVersion)) {
    throw new Error('Provider credential active key version is missing from the keyring')
  }
  return { activeVersion, keys }
}

export interface ProviderCredentialCipherContext {
  scope: 'user' | 'workspace'
  scopeId: string
  providerId: string
}

function contextAad(context: ProviderCredentialCipherContext) {
  const prefix = context.scope === 'workspace'
    ? 'ai-canvas-cloud/provider-credential/v1'
    : 'ai-canvas-cloud/provider-credential/v2/user'
  return Buffer.from(`${prefix}/${context.scopeId}/${context.providerId}`, 'utf8')
}

function requireEnvelope(value: unknown): ProviderCredentialEnvelope {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !('algorithm' in value)
    || value.algorithm !== ALGORITHM
    || !('keyVersion' in value)
    || !Number.isInteger(value.keyVersion)
    || !('iv' in value)
    || typeof value.iv !== 'string'
    || !('ciphertext' in value)
    || typeof value.ciphertext !== 'string'
    || !('authTag' in value)
    || typeof value.authTag !== 'string'
  ) {
    throw new Error('Provider credential envelope is invalid')
  }
  return value as ProviderCredentialEnvelope
}

export function createProviderCredentialCipher(keyring: ProviderCredentialKeyring) {
  return {
    encrypt(secret: string, context: ProviderCredentialCipherContext) {
      const key = keyring.keys.get(keyring.activeVersion)!
      const iv = randomBytes(12)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      cipher.setAAD(contextAad(context))
      const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
      return {
        algorithm: ALGORITHM,
        keyVersion: keyring.activeVersion,
        iv: iv.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
      } satisfies ProviderCredentialEnvelope
    },

    decrypt(value: unknown, context: ProviderCredentialCipherContext) {
      const envelope = requireEnvelope(value)
      const key = keyring.keys.get(envelope.keyVersion)
      if (!key) {
        throw new Error('Provider credential key version is unavailable')
      }
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'))
        decipher.setAAD(contextAad(context))
        decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
        return Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8')
      } catch {
        throw new Error('Provider credential could not be decrypted')
      }
    },
  }
}

export type ProviderCredentialCipher = ReturnType<typeof createProviderCredentialCipher>
