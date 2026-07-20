import type {
  DeleteProviderCredentialResponse,
  ProviderConnectionTestResponse,
  ProviderSettingResponse,
  ProviderSettingsResponse,
  PutProviderCredentialRequest,
} from '@ai-canvas-cloud/contracts'
import type { DbClient, DbPool } from '../../db/postgres.js'
import { AuthServiceError } from '../auth/service.js'
import type { ProjectActor } from '../projects/service.js'
import { createWorkspaceAuthorizationService, type WorkspaceAuthorizationService } from '../workspaces/authorization.js'
import type { ProviderCredentialCipher } from './credentialCipher.js'
import { createProviderAdapter, ProviderGatewayError, type ProviderAdapter } from './adapter.js'
import {
  canonicalizeProviderBaseUrl,
  getCloudProviderDefinition,
  normalizeProviderBaseUrl,
  type CloudProviderType,
} from './registry.js'

const API_KEY_MAX_LENGTH = 4096
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/

interface ProviderCredentialSummaryRow {
  provider_id: string
  display_name: string
  provider_type: CloudProviderType
  website_url: string | null
  base_url: string
  secret_last_four: string
  status: 'active' | 'disabled'
  updated_at: Date | string
}

interface ProviderCredentialRow extends ProviderCredentialSummaryRow {
  workspace_id: string | null
  encrypted_secret_json: unknown
  key_version: number
}

export interface ProviderCredentialService {
  listProviders: (actor: ProjectActor) => Promise<ProviderSettingsResponse>
  putProvider: (providerId: string, input: PutProviderCredentialRequest, actor: ProjectActor) => Promise<ProviderSettingResponse>
  deleteProvider: (providerId: string, actor: ProjectActor) => Promise<DeleteProviderCredentialResponse>
  testConnection: (providerId: string, actor: ProjectActor) => Promise<ProviderConnectionTestResponse>
  getExecutionCredential: (input: { userId: string; providerId: string }) => Promise<{
    providerId: string
    providerType: CloudProviderType
    baseUrl: string
    apiKey: string
  }>
}

function validationError(message: string): never {
  throw new AuthServiceError({ statusCode: 400, apiCode: 'VALIDATION_FAILED', message })
}

function validateProviderId(value: string) {
  if (!PROVIDER_ID_PATTERN.test(value)) return validationError('Provider ID is invalid')
  return value
}

function validateLabel(value: unknown, fallback?: string) {
  const candidate = typeof value === 'string' ? value.trim() : fallback?.trim()
  if (!candidate || candidate.length > 80) return validationError('label must be between 1 and 80 characters')
  return candidate
}

function validateApiKey(value: unknown) {
  const hasControlCharacter = typeof value === 'string' && [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 31 || codePoint === 127
  })
  if (
    typeof value !== 'string'
    || value.length < 8
    || value.length > API_KEY_MAX_LENGTH
    || value !== value.trim()
    || hasControlCharacter
  ) {
    return validationError(`apiKey must be between 8 and ${API_KEY_MAX_LENGTH} characters without surrounding whitespace`)
  }
  return value
}

function defaultWebsiteUrl(providerId: string, baseUrl: string) {
  if (providerId === 'openai') return 'https://openai.com'
  if (providerId === 'aliyun') return 'https://www.aliyun.com/product/bailian'
  return new URL(canonicalizeProviderBaseUrl(baseUrl)).origin
}

function validateWebsiteUrl(value: unknown, fallback: string) {
  const candidate = typeof value === 'string' ? value.trim() : fallback
  if (!candidate) return validationError('websiteUrl is required')
  try {
    return canonicalizeProviderBaseUrl(candidate)
  } catch {
    return validationError('websiteUrl must be a public HTTPS URL')
  }
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toConfiguredSummary(row: ProviderCredentialSummaryRow) {
  return {
    providerId: row.provider_id,
    label: row.display_name,
    websiteUrl: row.website_url ?? defaultWebsiteUrl(row.provider_id, row.base_url),
    baseUrl: row.base_url,
    configured: true,
    status: row.status,
    secretLastFour: row.secret_last_four,
    updatedAt: toIso(row.updated_at),
  } as const
}

async function findCredential(pool: Pick<DbPool, 'query'>, userId: string, providerId: string) {
  const result = await pool.query<ProviderCredentialRow>(
    `SELECT workspace_id::text, provider_id, display_name, provider_type, website_url, base_url, encrypted_secret_json,
            key_version, secret_last_four, status, updated_at
     FROM provider_credentials WHERE user_id = $1 AND provider_id = $2 LIMIT 1`,
    [userId, providerId],
  )
  return result.rows[0] ?? null
}

function cipherContext(row: Pick<ProviderCredentialRow, 'workspace_id' | 'provider_id'>, userId: string) {
  return row.workspace_id
    ? { scope: 'workspace' as const, scopeId: row.workspace_id, providerId: row.provider_id }
    : { scope: 'user' as const, scopeId: userId, providerId: row.provider_id }
}

export async function lockConfiguredProviderCredential(
  client: Pick<DbClient, 'query'>,
  userId: string,
  providerId: string,
) {
  validateProviderId(providerId)
  const result = await client.query<Pick<ProviderCredentialRow, 'provider_id' | 'provider_type' | 'base_url'>>(
    `SELECT provider_id, provider_type, base_url FROM provider_credentials
     WHERE user_id = $1 AND provider_id = $2 AND status = 'active' FOR KEY SHARE`,
    [userId, providerId],
  )
  const row = result.rows[0]
  if (!row) {
    throw new AuthServiceError({
      statusCode: 409,
      apiCode: 'PROVIDER_CONFIG_INVALID',
      message: 'Provider credential is not configured',
    })
  }
  return {
    providerId: row.provider_id,
    providerType: row.provider_type,
    baseUrl: normalizeProviderBaseUrl(row.provider_id, row.base_url),
  }
}

export function createPostgresProviderCredentialService(
  pool: DbPool,
  options: {
    cipher: ProviderCredentialCipher
    authorizationService?: WorkspaceAuthorizationService
    adapter?: ProviderAdapter
  },
): ProviderCredentialService {
  const authorizationService = options.authorizationService ?? createWorkspaceAuthorizationService(pool)
  const adapter = options.adapter ?? createProviderAdapter()

  return {
    async listProviders(actor) {
      await authorizationService.requireWorkspaceAccess({ userId: actor.userId, workspaceId: actor.workspaceId })
      const result = await pool.query<ProviderCredentialSummaryRow>(
        `SELECT provider_id, display_name, provider_type, website_url, base_url, secret_last_four, status, updated_at
         FROM provider_credentials WHERE user_id = $1 ORDER BY display_name, provider_id`,
        [actor.userId],
      )
      return { providers: result.rows.map(toConfiguredSummary) }
    },

    async putProvider(providerIdValue, input, actor) {
      const providerId = validateProviderId(providerIdValue)
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return validationError('Provider credential request must be an object')
      }
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      })
      const existing = await findCredential(pool, actor.userId, providerId)
      const legacy = getCloudProviderDefinition(providerId)
      const label = validateLabel(input.label, existing?.display_name ?? legacy?.label ?? providerId)
      let baseUrl: string
      try {
        baseUrl = normalizeProviderBaseUrl(providerId, input.baseUrl ?? existing?.base_url)
      } catch (error) {
        return validationError(error instanceof Error ? error.message : 'Provider base URL is invalid')
      }
      const websiteUrl = validateWebsiteUrl(
        input.websiteUrl,
        existing?.website_url ?? defaultWebsiteUrl(providerId, baseUrl),
      )
      const providerType = existing?.provider_type ?? legacy?.providerType ?? 'openai_compatible'

      if (existing && input.apiKey === undefined) {
        const result = await pool.query<ProviderCredentialSummaryRow>(
          `UPDATE provider_credentials SET display_name = $3, website_url = $4, base_url = $5,
             updated_by_user_id = $6, updated_at = now()
           WHERE user_id = $1 AND provider_id = $2
           RETURNING provider_id, display_name, provider_type, website_url, base_url, secret_last_four, status, updated_at`,
          [actor.userId, providerId, label, websiteUrl, baseUrl, actor.userId],
        )
        return { provider: toConfiguredSummary(result.rows[0]!) }
      }

      const apiKey = validateApiKey(input.apiKey)
      const envelope = options.cipher.encrypt(apiKey, { scope: 'user', scopeId: actor.userId, providerId })
      const result = await pool.query<ProviderCredentialSummaryRow>(
         `INSERT INTO provider_credentials (
            user_id, provider_id, display_name, provider_type, website_url, base_url, encrypted_secret_json,
            key_version, secret_last_four, status, created_by_user_id, updated_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'active', $10, $10)
          ON CONFLICT (user_id, provider_id) DO UPDATE SET
            display_name = EXCLUDED.display_name, provider_type = EXCLUDED.provider_type,
            website_url = EXCLUDED.website_url, base_url = EXCLUDED.base_url, encrypted_secret_json = EXCLUDED.encrypted_secret_json,
            key_version = EXCLUDED.key_version, secret_last_four = EXCLUDED.secret_last_four,
            workspace_id = NULL, status = 'active', updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
          RETURNING provider_id, display_name, provider_type, website_url, base_url, secret_last_four, status, updated_at`,
        [actor.userId, providerId, label, providerType, websiteUrl, baseUrl, JSON.stringify(envelope), envelope.keyVersion, apiKey.slice(-4), actor.userId],
      )
      return { provider: toConfiguredSummary(result.rows[0]!) }
    },

    async deleteProvider(providerIdValue, actor) {
      const providerId = validateProviderId(providerIdValue)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      })
      await pool.query(`DELETE FROM provider_credentials WHERE user_id = $1 AND provider_id = $2`, [actor.userId, providerId])
      return { ok: true }
    },

    async testConnection(providerIdValue, actor) {
      const providerId = validateProviderId(providerIdValue)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      })
      const row = await findCredential(pool, actor.userId, providerId)
      if (!row || row.status !== 'active') {
        throw new AuthServiceError({ statusCode: 409, apiCode: 'PROVIDER_CONFIG_INVALID', message: 'Provider credential is not configured' })
      }
      const apiKey = options.cipher.decrypt(row.encrypted_secret_json, cipherContext(row, actor.userId))
      try {
        await adapter.testConnection({ providerId, providerType: row.provider_type, baseUrl: row.base_url, apiKey })
      } catch (error) {
        if (!(error instanceof ProviderGatewayError)) throw error
        const configurationError = error.category === 'authentication' || error.category === 'rejected'
        throw new AuthServiceError({
          statusCode: configurationError ? 409 : 503,
          apiCode: configurationError ? 'PROVIDER_CONFIG_INVALID' : 'PROVIDER_UNAVAILABLE',
          message: configurationError ? 'Provider rejected the configured credential' : 'Provider connection test failed',
          retryable: error.retryable,
          details: { category: error.category },
        })
      }
      return { providerId, ok: true, checkedAt: new Date().toISOString() }
    },

    async getExecutionCredential(input) {
      const providerId = validateProviderId(input.providerId)
      const row = await findCredential(pool, input.userId, providerId)
      if (!row || row.status !== 'active') {
        throw new AuthServiceError({ statusCode: 409, apiCode: 'PROVIDER_CONFIG_INVALID', message: 'Provider credential is not configured' })
      }
      return {
        providerId,
        providerType: row.provider_type,
        baseUrl: normalizeProviderBaseUrl(providerId, row.base_url),
        apiKey: options.cipher.decrypt(row.encrypted_secret_json, cipherContext(row, input.userId)),
      }
    },
  }
}

export function createUnavailableProviderCredentialService(): ProviderCredentialService {
  const unavailable = (): never => {
    throw new AuthServiceError({ statusCode: 503, apiCode: 'SERVICE_UNAVAILABLE', message: 'Provider credential service is not configured', retryable: true })
  }
  return {
    async listProviders() { return unavailable() },
    async putProvider() { return unavailable() },
    async deleteProvider() { return unavailable() },
    async testConnection() { return unavailable() },
    async getExecutionCredential() { return unavailable() },
  }
}
