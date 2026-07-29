import { randomUUID } from "node:crypto";
import type {
  ObjectStorageSettingsInput,
  ObjectStorageSettingsResponse,
  ObjectStorageTestResponse,
  RestoreEnvironmentObjectStorageInput,
} from "@ai-canvas-cloud/contracts";
import {
  validateObjectStorageSettingsInput,
  validateRestoreEnvironmentObjectStorageInput,
} from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import {
  createS3ObjectStorage,
  decryptObjectStorageCredentials,
  encryptObjectStorageCredentials,
  type ObjectStorageCredentialEnvelope,
  type ObjectStorageCredentialKeyring,
  type ObjectStorageCredentials,
  type S3ObjectStorageOptions,
} from "../assets/index.js";
import { insertAdminAuditEvent } from "./adminAudit.js";
import { AdminAccessError } from "./security.js";
import type { AdminService } from "./service.js";
import type { AdminRequestContext, AdminSession } from "./types.js";

interface ObjectStorageConfigRow {
  revision_id: string;
  endpoint: string;
  public_endpoint: string;
  public_origin: string;
  region: string;
  bucket: string;
  force_path_style: boolean;
  encrypted_credentials_json: ObjectStorageCredentialEnvelope;
  updated_at: Date | string;
}

export interface ObjectStorageEnvironmentConfig extends S3ObjectStorageOptions {
  publicOrigin: string;
}

export interface AdminObjectStorageConfigService {
  getCurrent(
    context: AdminRequestContext,
  ): Promise<ObjectStorageSettingsResponse>;
  testConnection(
    input: ObjectStorageSettingsInput,
    context: AdminRequestContext,
  ): Promise<ObjectStorageTestResponse>;
  publish(
    input: ObjectStorageSettingsInput,
    context: AdminRequestContext,
  ): Promise<ObjectStorageSettingsResponse>;
  restoreEnvironment(
    input: RestoreEnvironmentObjectStorageInput,
    context: AdminRequestContext,
  ): Promise<ObjectStorageSettingsResponse>;
}

interface Options {
  adminService: AdminService;
  keyring: ObjectStorageCredentialKeyring;
  fallbackConfig?: ObjectStorageEnvironmentConfig;
  auditSecret: string;
  invalidateManagedConfig?: () => void;
  testStorage?: (
    config: S3ObjectStorageOptions,
    probeKey: string,
  ) => Promise<void>;
}

function validationError(error: unknown) {
  return new AdminAccessError(
    400,
    "VALIDATION_FAILED",
    error instanceof Error
      ? error.message
      : "Object storage settings are invalid",
  );
}

type Queryable = Pick<DbPool, "query">;

async function readCurrent(pool: Queryable, lock = false) {
  const result = await pool.query<ObjectStorageConfigRow>(`
    SELECT r.id::text AS revision_id, r.endpoint, r.public_endpoint,
           r.public_origin, r.region, r.bucket, r.force_path_style,
           r.encrypted_credentials_json, c.updated_at
    FROM admin.object_storage_config_current c
    JOIN admin.object_storage_config_revisions r ON r.id = c.revision_id
    WHERE c.singleton_id = 1
    ${lock ? "FOR UPDATE OF c" : ""}
  `);
  return result.rows[0] ?? null;
}

async function hasAssets(pool: Queryable) {
  const result = await pool.query<{ present: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM public.assets
      WHERE deleted_at IS NULL AND status <> 'deleted'
    ) AS present
  `);
  return Boolean(result.rows[0]?.present);
}

function responseFrom(
  row: ObjectStorageConfigRow | null,
  fallback: ObjectStorageEnvironmentConfig | undefined,
  identityLocked: boolean,
): ObjectStorageSettingsResponse {
  if (!row) {
    if (!fallback) {
      return {
        source: "unconfigured",
        endpoint: "",
        publicEndpoint: "",
        publicOrigin: "",
        region: "",
        bucket: "",
        forcePathStyle: false,
        credentialsConfigured: false,
        environmentFallbackConfigured: false,
        identityLocked,
        revisionId: null,
        updatedAt: null,
      };
    }
    return {
      source: "environment",
      endpoint: fallback.endpoint,
      publicEndpoint: fallback.publicEndpoint ?? fallback.endpoint,
      publicOrigin: fallback.publicOrigin,
      region: fallback.region,
      bucket: fallback.bucket,
      forcePathStyle: fallback.forcePathStyle ?? true,
      credentialsConfigured: true,
      environmentFallbackConfigured: true,
      identityLocked,
      revisionId: null,
      updatedAt: null,
    };
  }
  return {
    source: "managed",
    endpoint: row.endpoint,
    publicEndpoint: row.public_endpoint,
    publicOrigin: row.public_origin,
    region: row.region,
    bucket: row.bucket,
    forcePathStyle: row.force_path_style,
    credentialsConfigured: true,
    environmentFallbackConfigured: Boolean(fallback),
    identityLocked,
    revisionId: row.revision_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function assertExpectedRevision(
  expectedRevisionId: string | null,
  current: ObjectStorageConfigRow | null,
) {
  if ((current?.revision_id ?? null) !== expectedRevisionId) {
    throw new AdminAccessError(
      409,
      "OBJECT_STORAGE_CONFIG_CONFLICT",
      "Object storage configuration changed; reload and try again",
    );
  }
}

function credentialsFor(
  input: ObjectStorageSettingsInput,
  current: ObjectStorageConfigRow | null,
  keyring: ObjectStorageCredentialKeyring,
): ObjectStorageCredentials {
  if (input.accessKeyId && input.secretAccessKey) {
    return {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    };
  }
  if (current) {
    return decryptObjectStorageCredentials(
      current.encrypted_credentials_json,
      current.revision_id,
      keyring,
    );
  }
  throw new AdminAccessError(
    400,
    "VALIDATION_FAILED",
    "credentials are required for the first managed object storage configuration",
  );
}

function candidate(
  input: ObjectStorageSettingsInput,
  credentials: ObjectStorageCredentials,
): S3ObjectStorageOptions {
  return {
    endpoint: input.endpoint,
    publicEndpoint: input.publicEndpoint,
    region: input.region,
    bucket: input.bucket,
    forcePathStyle: input.forcePathStyle,
    ...credentials,
  };
}

function assertStorageIdentity(
  input: ObjectStorageSettingsInput,
  current: ObjectStorageConfigRow | null,
  fallback: ObjectStorageEnvironmentConfig | undefined,
  identityLocked: boolean,
) {
  if (!identityLocked) return;
  const base = current
    ? {
        endpoint: current.endpoint,
        region: current.region,
        bucket: current.bucket,
        forcePathStyle: current.force_path_style,
      }
    : fallback;
  if (!base) {
    throw new AdminAccessError(
      409,
      "OBJECT_STORAGE_IDENTITY_LOCKED",
      "Object storage identity cannot be recovered while assets exist",
    );
  }
  if (
    input.endpoint !== base.endpoint ||
    input.region !== base.region ||
    input.bucket !== base.bucket ||
    input.forcePathStyle !== (base.forcePathStyle ?? true)
  ) {
    throw new AdminAccessError(
      409,
      "OBJECT_STORAGE_IDENTITY_LOCKED",
      "Object storage identity cannot change while assets exist",
    );
  }
}

async function defaultTestStorage(
  config: S3ObjectStorageOptions,
  probeKey: string,
) {
  const storage = createS3ObjectStorage(config);
  const body = Buffer.from(`ai-canvas-storage-test:${randomUUID()}`, "utf8");
  let deleted = false;
  try {
    await storage.checkHealth();
    await storage.putObject({
      objectKey: probeKey,
      body,
      mimeType: "application/octet-stream",
    });
    const received = await storage.getObjectBytes({
      objectKey: probeKey,
      maxBytes: body.byteLength + 1,
    });
    if (!Buffer.from(received).equals(body)) {
      throw new Error("Object storage probe mismatch");
    }
    await storage.deleteObject(probeKey);
    deleted = true;
  } finally {
    if (!deleted) await storage.deleteObject(probeKey).catch(() => undefined);
    storage.destroy();
  }
}

export function createPostgresAdminObjectStorageConfigService(
  pool: DbPool,
  options: Options,
): AdminObjectStorageConfigService {
  const testStorage = options.testStorage ?? defaultTestStorage;

  async function requireSession(context: AdminRequestContext) {
    return options.adminService.requirePermission(
      context,
      "object_storage_config.write",
    );
  }

  function parseInput(raw: unknown) {
    try {
      return validateObjectStorageSettingsInput(raw);
    } catch (error) {
      throw validationError(error);
    }
  }

  async function reserveAttempt(session: AdminSession) {
    return withTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `object-storage-test:${session.admin.id}`,
      ]);
      const recent = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM admin.object_storage_test_attempts
         WHERE admin_user_id = $1 AND created_at > now() - interval '10 minutes'`,
        [session.admin.id],
      );
      if (Number(recent.rows[0]?.count ?? 0) >= 5) {
        throw new AdminAccessError(
          429,
          "OBJECT_STORAGE_RATE_LIMITED",
          "Too many object storage tests; try again later",
        );
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO admin.object_storage_test_attempts (id, admin_user_id)
         VALUES ($1, $2)`,
        [id, session.admin.id],
      );
      return id;
    });
  }

  async function completeAttempt(
    id: string,
    result: "success" | "failure",
    failureCategory?: string,
  ) {
    await pool.query(
      `UPDATE admin.object_storage_test_attempts
       SET result = $2, failure_category = $3, completed_at = now()
       WHERE id = $1 AND result = 'pending'`,
      [id, result, failureCategory ?? null],
    );
  }

  async function audit(
    session: AdminSession,
    context: AdminRequestContext,
    action: string,
    result: "success" | "failure",
    after: Record<string, unknown>,
  ) {
    await withTransaction(pool, (client) =>
      insertAdminAuditEvent(
        client,
        {
          actor: session.admin,
          action,
          targetType: "object_storage_configuration",
          targetId: "global",
          result,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          after,
        },
        options.auditSecret,
      ),
    );
  }

  async function validatedCandidate(raw: unknown) {
    const input = parseInput(raw);
    const current = await readCurrent(pool);
    assertExpectedRevision(input.expectedRevisionId, current);
    const identityLocked = await hasAssets(pool);
    assertStorageIdentity(
      input,
      current,
      options.fallbackConfig,
      identityLocked,
    );
    const credentials = credentialsFor(input, current, options.keyring);
    return {
      input,
      current,
      credentials,
      config: candidate(input, credentials),
    };
  }

  return {
    async getCurrent(context) {
      await requireSession(context);
      return responseFrom(
        await readCurrent(pool),
        options.fallbackConfig,
        await hasAssets(pool),
      );
    },

    async testConnection(raw, context) {
      const session = await requireSession(context);
      const attemptId = await reserveAttempt(session);
      try {
        const { config } = await validatedCandidate(raw);
        await testStorage(config, `.ai-canvas/storage-tests/${randomUUID()}`);
        await completeAttempt(attemptId, "success");
        await audit(
          session,
          context,
          "admin.object_storage.connection_tested",
          "success",
          {},
        );
        return { ok: true, testedAt: new Date().toISOString() };
      } catch (error) {
        await completeAttempt(attemptId, "failure", "connection");
        await audit(
          session,
          context,
          "admin.object_storage.connection_tested",
          "failure",
          {},
        );
        if (error instanceof AdminAccessError) throw error;
        throw new AdminAccessError(
          422,
          "OBJECT_STORAGE_CONNECTION_FAILED",
          "Object storage read-write-delete test failed",
        );
      }
    },

    async publish(raw, context) {
      const session = await requireSession(context);
      const { input, config } = await validatedCandidate(raw);
      await testStorage(config, `.ai-canvas/storage-tests/${randomUUID()}`);
      const revisionId = randomUUID();
      const credentials: ObjectStorageCredentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
      const envelope = encryptObjectStorageCredentials(
        credentials,
        revisionId,
        options.keyring,
      );
      await withTransaction(pool, async (client) => {
        const current = await readCurrent(client, true);
        assertExpectedRevision(input.expectedRevisionId, current);
        const identityLocked = await hasAssets(client);
        assertStorageIdentity(
          input,
          current,
          options.fallbackConfig,
          identityLocked,
        );
        await client.query(
          `INSERT INTO admin.object_storage_config_revisions (
             id, endpoint, public_endpoint, public_origin, region, bucket,
             force_path_style, encrypted_credentials_json, key_version,
             created_by_admin_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            revisionId,
            input.endpoint,
            input.publicEndpoint,
            input.publicOrigin,
            input.region,
            input.bucket,
            input.forcePathStyle,
            envelope,
            envelope.keyVersion,
            session.admin.id,
          ],
        );
        await client.query(
          `INSERT INTO admin.object_storage_config_current (
             singleton_id, revision_id, updated_by_admin_id, updated_at
           ) VALUES (1, $1, $2, now())
           ON CONFLICT (singleton_id) DO UPDATE SET
             revision_id = EXCLUDED.revision_id,
             updated_by_admin_id = EXCLUDED.updated_by_admin_id,
             updated_at = now()`,
          [revisionId, session.admin.id],
        );
        await client.query(
          `INSERT INTO public.object_storage_config_publications (
             singleton_id, revision_id, endpoint, public_endpoint,
             public_origin, region, bucket, force_path_style,
             encrypted_credentials_json, key_version, published_at
           ) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT (singleton_id) DO UPDATE SET
             revision_id = EXCLUDED.revision_id,
             endpoint = EXCLUDED.endpoint,
             public_endpoint = EXCLUDED.public_endpoint,
             public_origin = EXCLUDED.public_origin,
             region = EXCLUDED.region,
             bucket = EXCLUDED.bucket,
             force_path_style = EXCLUDED.force_path_style,
             encrypted_credentials_json = EXCLUDED.encrypted_credentials_json,
             key_version = EXCLUDED.key_version,
             published_at = now()`,
          [
            revisionId,
            input.endpoint,
            input.publicEndpoint,
            input.publicOrigin,
            input.region,
            input.bucket,
            input.forcePathStyle,
            envelope,
            envelope.keyVersion,
          ],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.object_storage.published",
            targetType: "object_storage_configuration",
            targetId: "global",
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: {
              revisionId,
              endpoint: input.endpoint,
              publicEndpoint: input.publicEndpoint,
              publicOrigin: input.publicOrigin,
              region: input.region,
              bucket: input.bucket,
              forcePathStyle: input.forcePathStyle,
              credentialsConfigured: true,
            },
          },
          options.auditSecret,
        );
      });
      options.invalidateManagedConfig?.();
      return responseFrom(
        await readCurrent(pool),
        options.fallbackConfig,
        await hasAssets(pool),
      );
    },

    async restoreEnvironment(raw, context) {
      const session = await requireSession(context);
      if (!options.fallbackConfig) {
        throw new AdminAccessError(
          409,
          "OBJECT_STORAGE_ENVIRONMENT_FALLBACK_UNAVAILABLE",
          "No environment object storage fallback is configured",
        );
      }
      let input: RestoreEnvironmentObjectStorageInput;
      try {
        input = validateRestoreEnvironmentObjectStorageInput(raw);
      } catch (error) {
        throw validationError(error);
      }
      await withTransaction(pool, async (client) => {
        const current = await readCurrent(client, true);
        assertExpectedRevision(input.expectedRevisionId, current);
        await client.query(
          "DELETE FROM admin.object_storage_config_current WHERE singleton_id = 1",
        );
        await client.query(
          "DELETE FROM public.object_storage_config_publications WHERE singleton_id = 1",
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.object_storage.environment_restored",
            targetType: "object_storage_configuration",
            targetId: "global",
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: { source: "environment" },
          },
          options.auditSecret,
        );
      });
      options.invalidateManagedConfig?.();
      return responseFrom(null, options.fallbackConfig, await hasAssets(pool));
    },
  };
}

export function createUnavailableAdminObjectStorageConfigService(): AdminObjectStorageConfigService {
  const unavailable = async (): Promise<never> => {
    throw new Error(
      "Admin object storage configuration service is unavailable",
    );
  };
  return {
    getCurrent: unavailable,
    testConnection: unavailable,
    publish: unavailable,
    restoreEnvironment: unavailable,
  };
}
