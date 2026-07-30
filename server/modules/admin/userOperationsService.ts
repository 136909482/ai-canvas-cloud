import {
  validateAdminManagedUserId,
  validateAdminUserActionRequest,
  validateAdminUserListQuery,
  validateAdminUserPasswordResetRequest,
  type AdminManagedUserSummary,
  type AdminManagedWorkspaceSummary,
  type AdminUserResponse,
  type AdminUserPasswordResetResponse,
  type AdminUserSessionRevocationResponse,
  type AdminUserStatusActionResponse,
  type AdminUsersResponse,
} from "@ai-canvas-cloud/contracts";
import { hashPassword } from "better-auth/crypto";
import { withTransaction, type DbPool } from "../../db/postgres.js";
import { insertAdminAuditEvent } from "./adminAudit.js";
import { AdminAccessError } from "./security.js";
import {
  createPostgresAdminAccountDeletionService,
  type AdminAccountDeletionService,
} from "./accountDeletionService.js";
import type { AdminService } from "./service.js";
import type { AdminRequestContext } from "./types.js";

interface AdminUserListRow {
  id: string;
  user_no: string | number;
  display_username: string;
  email: string;
  email_verified: boolean;
  status: "active" | "disabled" | "deleted";
  workspace_count: string | number;
  storage_used_bytes: string | number;
  active_session_count: string | number;
  last_active_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AdminUserCursor {
  createdAt: string;
  id: string;
}

interface AdminWorkspaceRow {
  id: string;
  name: string;
  type: "personal" | "team";
  role: "owner" | "admin" | "editor" | "viewer";
  status: "active" | "disabled" | "deleted";
  plan_key: string;
  storage_quota_bytes: string | number;
  storage_used_bytes: string | number;
  storage_reserved_bytes: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AdminUserOperationsService {
  listUsers(
    query: unknown,
    context: AdminRequestContext,
  ): Promise<AdminUsersResponse>;
  getUser(
    userId: unknown,
    context: AdminRequestContext,
  ): Promise<AdminUserResponse>;
  banUser(
    userId: unknown,
    input: unknown,
    context: AdminRequestContext,
  ): Promise<AdminUserStatusActionResponse>;
  unbanUser(
    userId: unknown,
    input: unknown,
    context: AdminRequestContext,
  ): Promise<AdminUserStatusActionResponse>;
  revokeUserSessions(
    userId: unknown,
    input: unknown,
    context: AdminRequestContext,
  ): Promise<AdminUserSessionRevocationResponse>;
  resetUserPassword(
    userId: unknown,
    input: unknown,
    context: AdminRequestContext,
  ): Promise<AdminUserPasswordResetResponse>;
  getUserDeletionPreview(
    userId: unknown,
    context: AdminRequestContext,
  ): ReturnType<AdminAccountDeletionService["getDeletionPreview"]>;
  deleteUser(
    userId: unknown,
    input: unknown,
    context: AdminRequestContext,
  ): ReturnType<AdminAccountDeletionService["deleteUser"]>;
}

export interface PostgresAdminUserOperationsOptions {
  adminService: Pick<AdminService, "requirePermission">;
  auditSecret: string;
  passwordHasher?: (password: string) => Promise<string>;
  ordinaryAuthSecret: string;
}

export function createUnavailableAdminUserOperationsService(): AdminUserOperationsService {
  const unavailable = async (): Promise<never> => {
    throw new Error("Administrator user operations service is unavailable");
  };
  return {
    listUsers: unavailable,
    getUser: unavailable,
    banUser: unavailable,
    unbanUser: unavailable,
    revokeUserSessions: unavailable,
    resetUserPassword: unavailable,
    getUserDeletionPreview: unavailable,
    deleteUser: unavailable,
  };
}

function validationError(message: string) {
  return new AdminAccessError(400, "VALIDATION_FAILED", message);
}

function toIso(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error("Administrator user timestamp is invalid");
  return parsed.toISOString();
}

function toSafeInteger(value: string | number, field: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`${field} is outside the safe integer range`);
  return parsed;
}

function toUserSummary(row: AdminUserListRow): AdminManagedUserSummary {
  return {
    id: row.id,
    userNumber: toSafeInteger(row.user_no, "userNumber"),
    username: row.display_username,
    email: row.email,
    emailVerified: row.email_verified,
    status: row.status,
    workspaceCount: toSafeInteger(row.workspace_count, "workspaceCount"),
    storageUsedBytes: toSafeInteger(row.storage_used_bytes, "storageUsedBytes"),
    activeSessionCount: toSafeInteger(
      row.active_session_count,
      "activeSessionCount",
    ),
    lastActiveAt: row.last_active_at ? toIso(row.last_active_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toWorkspaceSummary(
  row: AdminWorkspaceRow,
): AdminManagedWorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    role: row.role,
    status: row.status,
    planKey: row.plan_key,
    storageQuotaBytes: toSafeInteger(
      row.storage_quota_bytes,
      "storageQuotaBytes",
    ),
    storageUsedBytes: toSafeInteger(row.storage_used_bytes, "storageUsedBytes"),
    storageReservedBytes: toSafeInteger(
      row.storage_reserved_bytes,
      "storageReservedBytes",
    ),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function normalizeUserId(value: unknown) {
  try {
    return validateAdminManagedUserId(value);
  } catch (error) {
    throw validationError(
      error instanceof Error ? error.message : "userId is invalid",
    );
  }
}

function normalizeActionRequest(value: unknown) {
  try {
    return validateAdminUserActionRequest(value);
  } catch (error) {
    throw validationError(
      error instanceof Error ? error.message : "User action request is invalid",
    );
  }
}

function normalizePasswordResetRequest(value: unknown) {
  try {
    return validateAdminUserPasswordResetRequest(value);
  } catch (error) {
    throw validationError(
      error instanceof Error
        ? error.message
        : "User password reset request is invalid",
    );
  }
}

function encodeCursor(user: AdminManagedUserSummary) {
  return Buffer.from(
    JSON.stringify({
      createdAt: user.createdAt,
      id: user.id,
    } satisfies AdminUserCursor),
  ).toString("base64url");
}

function decodeCursor(value: string): AdminUserCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<AdminUserCursor>;
    if (!parsed || Object.keys(parsed).sort().join(",") !== "createdAt,id")
      throw new Error();
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(new Date(parsed.createdAt).getTime())
    )
      throw new Error();
    return {
      createdAt: new Date(parsed.createdAt).toISOString(),
      id: validateAdminManagedUserId(parsed.id),
    };
  } catch {
    throw validationError("cursor is invalid");
  }
}

export function createPostgresAdminUserOperationsService(
  pool: DbPool,
  options: PostgresAdminUserOperationsOptions,
): AdminUserOperationsService {
  const passwordHasher = options.passwordHasher ?? hashPassword;
  const accountDeletionService = createPostgresAdminAccountDeletionService(
    pool,
    {
      adminService: options.adminService,
      auditSecret: options.auditSecret,
      ordinaryAuthSecret: options.ordinaryAuthSecret,
    },
  );
  const service: AdminUserOperationsService = {
    getUserDeletionPreview: (userId, context) =>
      accountDeletionService.getDeletionPreview(userId, context),
    deleteUser: (userId, input, context) =>
      accountDeletionService.deleteUser(userId, input, context),
    async listUsers(query, context) {
      await options.adminService.requirePermission(context, "user.read");
      let validated;
      try {
        validated = validateAdminUserListQuery(query);
      } catch (error) {
        throw validationError(
          error instanceof Error ? error.message : "User list query is invalid",
        );
      }

      const values: unknown[] = [];
      const clauses: string[] = [];
      if (validated.cursor) {
        const cursor = decodeCursor(validated.cursor);
        values.push(cursor.createdAt, cursor.id);
        clauses.push(
          `(u.created_at, u.id) < ($${values.length - 1}::timestamptz, $${values.length}::text)`,
        );
      }
      if (validated.status) {
        values.push(validated.status);
        clauses.push(`u.status = $${values.length}`);
      }
      if (validated.verification) {
        values.push(validated.verification === "verified");
        clauses.push(`u.email_verified = $${values.length}`);
      }
      if (validated.search) {
        values.push(validated.search.toLocaleLowerCase("en-US"));
        const parameter = `$${values.length}`;
        clauses.push(`(
          u.user_no::text = ${parameter}
          OR position(${parameter} in lower(u.email)) > 0
          OR position(${parameter} in lower(u.display_username)) > 0
        )`);
      }
      values.push(validated.limit + 1);

      const result = await pool.query<AdminUserListRow>(
        `
        WITH workspace_usage AS (
          SELECT
            wm.user_id,
            count(*)::bigint AS workspace_count,
            COALESCE(sum(COALESCE(asset_usage.used_bytes, 0)), 0)::bigint AS storage_used_bytes
          FROM public.workspace_members wm
          JOIN public.workspaces w
            ON w.id = wm.workspace_id
           AND w.status <> 'deleted'
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(a.byte_size), 0)::bigint AS used_bytes
            FROM public.assets a
            WHERE a.workspace_id = w.id
              AND a.deleted_at IS NULL
              AND a.status IN ('completed', 'failed', 'quarantined')
          ) asset_usage ON true
          GROUP BY wm.user_id
        ), session_usage AS (
          SELECT
            s.user_id,
            count(*) FILTER (WHERE s.expires_at > now())::bigint AS active_session_count,
            max(s.updated_at) AS last_active_at
          FROM public."session" s
          GROUP BY s.user_id
        )
        SELECT
          u.id,
          u.user_no,
          u.display_username,
          u.email,
          u.email_verified,
          u.status,
          COALESCE(wu.workspace_count, 0)::bigint AS workspace_count,
          COALESCE(wu.storage_used_bytes, 0)::bigint AS storage_used_bytes,
          COALESCE(su.active_session_count, 0)::bigint AS active_session_count,
          su.last_active_at,
          u.created_at,
          u.updated_at
        FROM public."user" u
        LEFT JOIN workspace_usage wu ON wu.user_id = u.id
        LEFT JOIN session_usage su ON su.user_id = u.id
        ${clauses.length ? `WHERE ${clauses.join("\n          AND ")}` : ""}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $${values.length}
      `,
        values,
      );

      const hasMore = result.rows.length > validated.limit;
      const items = result.rows.slice(0, validated.limit).map(toUserSummary);
      return {
        items,
        nextCursor:
          hasMore && items.length > 0 ? encodeCursor(items.at(-1)!) : null,
      };
    },

    async getUser(userId, context) {
      await options.adminService.requirePermission(context, "user.read");
      const normalizedUserId = normalizeUserId(userId);
      const userResult = await pool.query<AdminUserListRow>(
        `
        WITH workspace_usage AS (
          SELECT
            wm.user_id,
            count(*)::bigint AS workspace_count,
            COALESCE(sum(COALESCE(asset_usage.used_bytes, 0)), 0)::bigint AS storage_used_bytes
          FROM public.workspace_members wm
          JOIN public.workspaces w
            ON w.id = wm.workspace_id
           AND w.status <> 'deleted'
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(a.byte_size), 0)::bigint AS used_bytes
            FROM public.assets a
            WHERE a.workspace_id = w.id
              AND a.deleted_at IS NULL
              AND a.status IN ('completed', 'failed', 'quarantined')
          ) asset_usage ON true
          WHERE wm.user_id = $1
          GROUP BY wm.user_id
        ), session_usage AS (
          SELECT
            s.user_id,
            count(*) FILTER (WHERE s.expires_at > now())::bigint AS active_session_count,
            max(s.updated_at) AS last_active_at
          FROM public."session" s
          WHERE s.user_id = $1
          GROUP BY s.user_id
        )
        SELECT
          u.id,
          u.user_no,
          u.display_username,
          u.email,
          u.email_verified,
          u.status,
          COALESCE(wu.workspace_count, 0)::bigint AS workspace_count,
          COALESCE(wu.storage_used_bytes, 0)::bigint AS storage_used_bytes,
          COALESCE(su.active_session_count, 0)::bigint AS active_session_count,
          su.last_active_at,
          u.created_at,
          u.updated_at
        FROM public."user" u
        LEFT JOIN workspace_usage wu ON wu.user_id = u.id
        LEFT JOIN session_usage su ON su.user_id = u.id
        WHERE u.id = $1
        LIMIT 1
      `,
        [normalizedUserId],
      );
      const userRow = userResult.rows[0];
      if (!userRow)
        throw new AdminAccessError(
          404,
          "RESOURCE_NOT_FOUND",
          "User was not found",
        );

      const workspaceResult = await pool.query<AdminWorkspaceRow>(
        `
        SELECT
          w.id::text,
          w.name,
          w.type,
          wm.role,
          w.status,
          w.plan_key,
          w.storage_quota_bytes,
          COALESCE(asset_usage.used_bytes, 0)::bigint AS storage_used_bytes,
          (COALESCE(asset_usage.reserved_bytes, 0) + COALESCE(import_usage.reserved_bytes, 0))::bigint AS storage_reserved_bytes,
          w.created_at,
          w.updated_at
        FROM public.workspace_members wm
        JOIN public.workspaces w
          ON w.id = wm.workspace_id
         AND w.status <> 'deleted'
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(sum(a.byte_size) FILTER (
              WHERE a.deleted_at IS NULL
                AND a.status IN ('completed', 'failed', 'quarantined')
            ), 0)::bigint AS used_bytes,
            COALESCE(sum(a.byte_size) FILTER (
              WHERE a.deleted_at IS NULL
                AND a.status = 'pending'
            ), 0)::bigint AS reserved_bytes
          FROM public.assets a
          WHERE a.workspace_id = w.id
        ) asset_usage ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(upload.expected_byte_size), 0)::bigint AS reserved_bytes
          FROM public.migration_import_asset_uploads upload
          WHERE upload.workspace_id = w.id
            AND upload.status IN ('pending', 'uploading', 'validating', 'completed')
            AND upload.committed_asset_id IS NULL
        ) import_usage ON true
        WHERE wm.user_id = $1
        ORDER BY CASE WHEN w.type = 'personal' THEN 0 ELSE 1 END, w.created_at ASC, w.id ASC
      `,
        [normalizedUserId],
      );

      return {
        user: toUserSummary(userRow),
        workspaces: workspaceResult.rows.map(toWorkspaceSummary),
      };
    },

    async banUser(userId, input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "user.write",
      );
      const normalizedUserId = normalizeUserId(userId);
      const request = normalizeActionRequest(input);
      const revokedSessionCount = await withTransaction(
        pool,
        async (client) => {
          const locked = await client.query<{
            status: "active" | "disabled" | "deleted";
          }>(
            `
          SELECT status
          FROM public."user"
          WHERE id = $1
          FOR UPDATE
        `,
            [normalizedUserId],
          );
          const current = locked.rows[0];
          if (!current)
            throw new AdminAccessError(
              404,
              "RESOURCE_NOT_FOUND",
              "User was not found",
            );
          if (current.status === "deleted") {
            throw new AdminAccessError(
              409,
              "VALIDATION_FAILED",
              "Deleted users cannot be changed",
            );
          }

          await client.query(
            `
          UPDATE public."user"
          SET status = 'disabled', updated_at = now()
          WHERE id = $1
        `,
            [normalizedUserId],
          );
          const revoked = await client.query<{ id: string }>(
            `
          DELETE FROM public."session"
          WHERE user_id = $1
          RETURNING id
        `,
            [normalizedUserId],
          );
          const count = revoked.rowCount ?? revoked.rows.length;
          await insertAdminAuditEvent(
            client,
            {
              actor: session.admin,
              action: "user.ban",
              targetType: "user",
              targetId: normalizedUserId,
              result: "success",
              requestId: context.requestId,
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
              before: { status: current.status },
              after: {
                status: "disabled",
                reason: request.reason,
                revokedSessionCount: count,
              },
            },
            options.auditSecret,
          );
          return count;
        },
      );

      const detail = await service.getUser(normalizedUserId, context);
      return { user: detail.user, revokedSessionCount };
    },

    async unbanUser(userId, input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "user.write",
      );
      const normalizedUserId = normalizeUserId(userId);
      const request = normalizeActionRequest(input);
      await withTransaction(pool, async (client) => {
        const locked = await client.query<{
          status: "active" | "disabled" | "deleted";
        }>(
          `
          SELECT status
          FROM public."user"
          WHERE id = $1
          FOR UPDATE
        `,
          [normalizedUserId],
        );
        const current = locked.rows[0];
        if (!current)
          throw new AdminAccessError(
            404,
            "RESOURCE_NOT_FOUND",
            "User was not found",
          );
        if (current.status === "deleted") {
          throw new AdminAccessError(
            409,
            "VALIDATION_FAILED",
            "Deleted users cannot be changed",
          );
        }

        await client.query(
          `
          UPDATE public."user"
          SET status = 'active', updated_at = now()
          WHERE id = $1
        `,
          [normalizedUserId],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "user.unban",
            targetType: "user",
            targetId: normalizedUserId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            before: { status: current.status },
            after: { status: "active", reason: request.reason },
          },
          options.auditSecret,
        );
      });

      const detail = await service.getUser(normalizedUserId, context);
      return { user: detail.user, revokedSessionCount: 0 };
    },

    async revokeUserSessions(userId, input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "user.write",
      );
      const normalizedUserId = normalizeUserId(userId);
      const request = normalizeActionRequest(input);
      const result = await withTransaction(pool, async (client) => {
        const locked = await client.query<{
          status: "active" | "disabled" | "deleted";
        }>(
          `
          SELECT status
          FROM public."user"
          WHERE id = $1
          FOR UPDATE
        `,
          [normalizedUserId],
        );
        const current = locked.rows[0];
        if (!current)
          throw new AdminAccessError(
            404,
            "RESOURCE_NOT_FOUND",
            "User was not found",
          );
        if (current.status === "deleted") {
          throw new AdminAccessError(
            409,
            "VALIDATION_FAILED",
            "Deleted users cannot be changed",
          );
        }

        const revoked = await client.query<{ id: string }>(
          `
          DELETE FROM public."session"
          WHERE user_id = $1
          RETURNING id
        `,
          [normalizedUserId],
        );
        const revokedSessionCount = revoked.rowCount ?? revoked.rows.length;
        const revokedAt = new Date().toISOString();
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "user.sessions.revoke",
            targetType: "user",
            targetId: normalizedUserId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            before: { status: current.status },
            after: { reason: request.reason, revokedSessionCount },
          },
          options.auditSecret,
        );
        return { revokedSessionCount, revokedAt };
      });

      return { userId: normalizedUserId, ...result };
    },

    async resetUserPassword(userId, input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "user.credentials.write",
      );
      const normalizedUserId = normalizeUserId(userId);
      const request = normalizePasswordResetRequest(input);
      const passwordHash = await passwordHasher(request.newPassword);
      const result = await withTransaction(pool, async (client) => {
        const locked = await client.query<{
          status: "active" | "disabled" | "deleted";
        }>(
          `
          SELECT status
          FROM public."user"
          WHERE id = $1
          FOR UPDATE
        `,
          [normalizedUserId],
        );
        const current = locked.rows[0];
        if (!current)
          throw new AdminAccessError(
            404,
            "RESOURCE_NOT_FOUND",
            "User was not found",
          );
        if (current.status === "deleted") {
          throw new AdminAccessError(
            409,
            "VALIDATION_FAILED",
            "Deleted users cannot be changed",
          );
        }

        const updated = await client.query(
          `
          UPDATE public."account"
          SET password = $2, updated_at = now()
          WHERE user_id = $1
            AND provider_id = 'credential'
        `,
          [normalizedUserId, passwordHash],
        );
        if (updated.rowCount !== 1) {
          throw new AdminAccessError(
            409,
            "VALIDATION_FAILED",
            "User does not have a password credential",
          );
        }

        const revoked = await client.query<{ id: string }>(
          `
          DELETE FROM public."session"
          WHERE user_id = $1
          RETURNING id
        `,
          [normalizedUserId],
        );
        const revokedSessionCount = revoked.rowCount ?? revoked.rows.length;
        const resetAt = new Date().toISOString();
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "user.password.reset",
            targetType: "user",
            targetId: normalizedUserId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            before: {},
            after: {
              reason: request.reason,
              revokedSessionCount,
              resetAt,
            },
          },
          options.auditSecret,
        );
        return { revokedSessionCount, resetAt };
      });

      return { userId: normalizedUserId, ...result };
    },
  };
  return service;
}
