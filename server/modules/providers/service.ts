import type {
  CloudProviderId,
  DeleteProviderCredentialResponse,
  ProviderConnectionTestResponse,
  ProviderSettingResponse,
  ProviderSettingsResponse,
  PutProviderCredentialRequest,
  WorkspaceRole,
} from '@ai-canvas-cloud/contracts'
import type { DbClient, DbPool } from '../../db/postgres.js'
import { AuthServiceError } from '../auth/service.js'
import type { ProjectActor } from '../projects/service.js'
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from '../workspaces/authorization.js'
import type { ProviderCredentialCipher } from './credentialCipher.js'
import { createProviderAdapter, ProviderGatewayError, type ProviderAdapter } from './adapter.js'
import {
  getCloudProviderDefinition,
  listCloudProviderDefinitions,
  normalizeProviderBaseUrl,
} from './registry.js'

const PROVIDER_WRITE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin']
const API_KEY_MAX_LENGTH = 4096

interface ProviderCredentialSummaryRow {
  provider_id: CloudProviderId
  base_url: string
  secret_last_four: string
  status: 'active' | 'disabled'
  updated_at: Date | string
}

interface ProviderCredentialRow extends ProviderCredentialSummaryRow {
  encrypted_secret_json: unknown
  key_version: number
}

export interface ProviderCredentialService {
  listProviders: (actor: ProjectActor) => Promise<ProviderSettingsResponse>
  putProvider: (
    providerId: string,
    input: PutProviderCredentialRequest,
    actor: ProjectActor,
  ) => Promise<ProviderSettingResponse>
  deleteProvider: (
    providerId: string,
    actor: ProjectActor,
  ) => Promise<DeleteProviderCredentialResponse>
  testConnection: (
    providerId: string,
    actor: ProjectActor,
  ) => Promise<ProviderConnectionTestResponse>
  getExecutionCredential: (input: {
    workspaceId: string
    providerId: string
  }) => Promise<{
    providerId: CloudProviderId
    baseUrl: string
    apiKey: string
  }>
}

function validationError(message: string): never {
  throw new AuthServiceError({ statusCode: 400, apiCode: 'VALIDATION_FAILED', message })
}

function requireProvider(providerId: string) {
  const definition = getCloudProviderDefinition(providerId)
  if (!definition) {
    return validationError('Provider is not supported')
  }
  return definition
}

function validateApiKey(value: unknown) {
  const hasControlCharacter = typeof value === 'string'
    && [...value].some((character) => {
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

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toConfiguredSummary(row: ProviderCredentialSummaryRow) {
  const definition = requireProvider(row.provider_id)
  return {
    providerId: row.provider_id,
    label: definition.label,
    baseUrl: row.base_url,
    configured: true,
    status: row.status,
    secretLastFour: row.secret_last_four,
    updatedAt: toIso(row.updated_at),
  } as const
}

async function findCredential(
  pool: Pick<DbPool, 'query'>,
  workspaceId: string,
  providerId: string,
) {
  const result = await pool.query<ProviderCredentialRow>(
    `
      SELECT provider_id, base_url, encrypted_secret_json, key_version,
             secret_last_four, status, updated_at
      FROM provider_credentials
      WHERE workspace_id = $1 AND provider_id = $2
      LIMIT 1
    `,
    [workspaceId, providerId],
  )
  return result.rows[0] ?? null
}

export async function lockConfiguredProviderCredential(
  client: Pick<DbClient, 'query'>,
  workspaceId: string,
  providerId: string,
) {
  const definition = requireProvider(providerId)
  const result = await client.query<{ base_url: string }>(
    `
      SELECT base_url
      FROM provider_credentials
      WHERE workspace_id = $1 AND provider_id = $2 AND status = 'active'
      FOR KEY SHARE
    `,
    [workspaceId, definition.id],
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
    providerId: definition.id,
    baseUrl: normalizeProviderBaseUrl(definition.id, row.base_url),
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
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      })
      const result = await pool.query<ProviderCredentialSummaryRow>(
        `
          SELECT provider_id, base_url, secret_last_four, status, updated_at
          FROM provider_credentials
          WHERE workspace_id = $1
        `,
        [actor.workspaceId],
      )
      const configured = new Map(result.rows.map((row) => [row.provider_id, row]))
      return {
        providers: listCloudProviderDefinitions().map((definition) => {
          const row = configured.get(definition.id)
          return row
            ? toConfiguredSummary(row)
            : {
                providerId: definition.id,
                label: definition.label,
                baseUrl: definition.defaultBaseUrl,
                configured: false,
                status: 'not_configured' as const,
                secretLastFour: null,
                updatedAt: null,
              }
        }),
      }
    },

    async putProvider(providerId, input, actor) {
      const definition = requireProvider(providerId)
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return validationError('Provider credential request must be an object')
      }
      const apiKey = validateApiKey(input.apiKey)
      let baseUrl: string
      try {
        baseUrl = normalizeProviderBaseUrl(definition.id, input.baseUrl)
      } catch (error) {
        return validationError(error instanceof Error ? error.message : 'Provider base URL is invalid')
      }
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: PROVIDER_WRITE_ROLES,
      })
      const envelope = options.cipher.encrypt(apiKey, {
        workspaceId: actor.workspaceId,
        providerId: definition.id,
      })
      const result = await pool.query<ProviderCredentialSummaryRow>(
        `
          INSERT INTO provider_credentials (
            workspace_id, provider_id, base_url, encrypted_secret_json,
            key_version, secret_last_four, status, created_by_user_id, updated_by_user_id
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'active', $7, $7)
          ON CONFLICT (workspace_id, provider_id) DO UPDATE
          SET base_url = EXCLUDED.base_url,
              encrypted_secret_json = EXCLUDED.encrypted_secret_json,
              key_version = EXCLUDED.key_version,
              secret_last_four = EXCLUDED.secret_last_four,
              status = 'active',
              updated_by_user_id = EXCLUDED.updated_by_user_id,
              updated_at = now()
          RETURNING provider_id, base_url, secret_last_four, status, updated_at
        `,
        [
          actor.workspaceId,
          definition.id,
          baseUrl,
          JSON.stringify(envelope),
          envelope.keyVersion,
          apiKey.slice(-4),
          actor.userId,
        ],
      )
      return { provider: toConfiguredSummary(result.rows[0]!) }
    },

    async deleteProvider(providerId, actor) {
      const definition = requireProvider(providerId)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: PROVIDER_WRITE_ROLES,
      })
      await pool.query(
        `DELETE FROM provider_credentials WHERE workspace_id = $1 AND provider_id = $2`,
        [actor.workspaceId, definition.id],
      )
      return { ok: true }
    },

    async testConnection(providerId, actor) {
      const definition = requireProvider(providerId)
      await authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        allowedRoles: PROVIDER_WRITE_ROLES,
      })
      const row = await findCredential(pool, actor.workspaceId, definition.id)
      if (!row || row.status !== 'active') {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: 'PROVIDER_CONFIG_INVALID',
          message: 'Provider credential is not configured',
        })
      }
      const apiKey = options.cipher.decrypt(row.encrypted_secret_json, {
        workspaceId: actor.workspaceId,
        providerId: definition.id,
      })
      try {
        await adapter.testConnection({ providerId: definition.id, apiKey })
      } catch (error) {
        if (!(error instanceof ProviderGatewayError)) {
          throw error
        }
        const configurationError = error.category === 'authentication' || error.category === 'rejected'
        throw new AuthServiceError({
          statusCode: configurationError ? 409 : 503,
          apiCode: configurationError ? 'PROVIDER_CONFIG_INVALID' : 'PROVIDER_UNAVAILABLE',
          message: configurationError ? 'Provider rejected the configured credential' : 'Provider connection test failed',
          retryable: error.retryable,
          details: { category: error.category },
        })
      }
      return { providerId: definition.id, ok: true, checkedAt: new Date().toISOString() }
    },

    async getExecutionCredential(input) {
      const definition = requireProvider(input.providerId)
      const row = await findCredential(pool, input.workspaceId, definition.id)
      if (!row || row.status !== 'active') {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: 'PROVIDER_CONFIG_INVALID',
          message: 'Provider credential is not configured',
        })
      }
      return {
        providerId: definition.id,
        baseUrl: normalizeProviderBaseUrl(definition.id, row.base_url),
        apiKey: options.cipher.decrypt(row.encrypted_secret_json, {
          workspaceId: input.workspaceId,
          providerId: definition.id,
        }),
      }
    },
  }
}

export function createUnavailableProviderCredentialService(): ProviderCredentialService {
  const unavailable = (): never => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: 'SERVICE_UNAVAILABLE',
      message: 'Provider credential service is not configured',
      retryable: true,
    })
  }
  return {
    async listProviders() { return unavailable() },
    async putProvider() { return unavailable() },
    async deleteProvider() { return unavailable() },
    async testConnection() { return unavailable() },
    async getExecutionCredential() { return unavailable() },
  }
}
