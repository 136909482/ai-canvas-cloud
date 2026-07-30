import { createHash, createHmac } from "node:crypto";
import {
  validateAdminManagedUserId,
  validateAdminUserDeletionRequest,
  type AdminUserDeletionPreview,
  type AdminUserDeletionResponse,
} from "@ai-canvas-cloud/contracts";
import { withTransaction, type DbPool } from "../../db/postgres.js";
import { insertAdminAuditEvent } from "./adminAudit.js";
import { AdminAccessError } from "./security.js";
import type { AdminService } from "./service.js";
import type { AdminRequestContext } from "./types.js";

const ACCOUNT_ERASURE_RETENTION_DAYS = 7;

interface LockedUserRow {
  id: string;
  user_no: string | number;
  email: string;
  status: "active" | "disabled" | "deleted";
}

interface OwnedTeamRow {
  id: string;
  name: string;
}

interface SuccessorRow {
  workspace_id: string;
  id: string;
  user_no: string | number;
  display_username: string;
}

export interface AdminAccountDeletionService {
  getDeletionPreview(
    userId: unknown,
    context: AdminRequestContext,
  ): Promise<AdminUserDeletionPreview>;
  deleteUser(
    userId: unknown,
    input: unknown,
    context: AdminRequestContext,
  ): Promise<AdminUserDeletionResponse>;
}

export interface PostgresAdminAccountDeletionOptions {
  adminService: Pick<AdminService, "requirePermission">;
  auditSecret: string;
  ordinaryAuthSecret: string;
  now?: () => Date;
}

function validationError(message: string) {
  return new AdminAccessError(400, "VALIDATION_FAILED", message);
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

function normalizeRequest(value: unknown) {
  try {
    return validateAdminUserDeletionRequest(value);
  } catch (error) {
    throw validationError(
      error instanceof Error
        ? error.message
        : "User deletion request is invalid",
    );
  }
}

function toSafeUserNumber(value: number | string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 10001) {
    throw new Error("Stored user number is invalid");
  }
  return number;
}

function emailChallengeHash(secret: string, purpose: string, email: string) {
  return createHmac("sha256", secret)
    .update(purpose)
    .update("\0")
    .update(email)
    .digest("hex");
}

function deletedUsername(userId: string) {
  // Keep the tombstone within the ordinary username contract without exposing
  // a reusable identifier or competing with a user-number-shaped username.
  return `deleted_${createHash("sha256").update(userId).digest("hex").slice(0, 22)}`;
}

async function requireExistingUser(pool: DbPool, userId: string) {
  const result = await pool.query<LockedUserRow>(
    `
      SELECT id, user_no, email, status
      FROM public."user"
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );
  const user = result.rows[0];
  if (!user) {
    throw new AdminAccessError(404, "RESOURCE_NOT_FOUND", "User was not found");
  }
  return user;
}

async function readOwnedTeams(pool: DbPool, userId: string) {
  const teams = await pool.query<OwnedTeamRow>(
    `
      SELECT w.id::text, w.name
      FROM public.workspaces w
      WHERE w.owner_user_id = $1
        AND w.type = 'team'
        AND w.status <> 'deleted'
      ORDER BY w.created_at, w.id
    `,
    [userId],
  );
  if (teams.rows.length === 0) return [];
  const candidates = await pool.query<SuccessorRow>(
    `
      SELECT wm.workspace_id::text, u.id, u.user_no, u.display_username
      FROM public.workspace_members wm
      JOIN public."user" u ON u.id = wm.user_id
      WHERE wm.workspace_id = ANY($1::uuid[])
        AND wm.user_id <> $2
        AND u.status = 'active'
      ORDER BY wm.workspace_id, u.user_no, u.id
    `,
    [teams.rows.map((team) => team.id), userId],
  );
  const candidatesByTeam = new Map<string, SuccessorRow[]>();
  for (const candidate of candidates.rows) {
    const list = candidatesByTeam.get(candidate.workspace_id) ?? [];
    list.push(candidate);
    candidatesByTeam.set(candidate.workspace_id, list);
  }
  return teams.rows.map((team) => ({
    id: team.id,
    name: team.name,
    successors: (candidatesByTeam.get(team.id) ?? []).map((candidate) => ({
      id: candidate.id,
      userNumber: toSafeUserNumber(candidate.user_no),
      username: candidate.display_username,
    })),
  }));
}

export function createPostgresAdminAccountDeletionService(
  pool: DbPool,
  options: PostgresAdminAccountDeletionOptions,
): AdminAccountDeletionService {
  return {
    async getDeletionPreview(userId, context) {
      await options.adminService.requirePermission(context, "user.delete");
      const normalizedUserId = normalizeUserId(userId);
      const user = await requireExistingUser(pool, normalizedUserId);
      if (user.status === "deleted") {
        throw new AdminAccessError(
          409,
          "USER_DELETION_ALREADY_REQUESTED",
          "User deletion has already been requested",
        );
      }
      const [counts, ownedTeams] = await Promise.all([
        pool.query<{
          personal_workspace_count: string | number;
          team_membership_count: string | number;
        }>(
          `
            SELECT
              count(*) FILTER (
                WHERE w.type = 'personal' AND w.status <> 'deleted'
              )::bigint AS personal_workspace_count,
              count(*) FILTER (
                WHERE w.type = 'team' AND w.status <> 'deleted'
              )::bigint AS team_membership_count
            FROM public.workspace_members wm
            JOIN public.workspaces w ON w.id = wm.workspace_id
            WHERE wm.user_id = $1
          `,
          [normalizedUserId],
        ),
        readOwnedTeams(pool, normalizedUserId),
      ]);
      const summary = counts.rows[0] ?? {
        personal_workspace_count: 0,
        team_membership_count: 0,
      };
      return {
        userId: normalizedUserId,
        userNumber: toSafeUserNumber(user.user_no),
        personalWorkspaceCount: Number(summary.personal_workspace_count),
        teamMembershipCount: Number(summary.team_membership_count),
        ownedTeams,
      };
    },

    async deleteUser(userId, input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "user.delete",
      );
      const normalizedUserId = normalizeUserId(userId);
      const request = normalizeRequest(input);
      const deletedAt = (options.now ?? (() => new Date()))();
      const purgeAfter = new Date(
        deletedAt.getTime() +
          ACCOUNT_ERASURE_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
      );

      return withTransaction(pool, async (client) => {
        const locked = await client.query<LockedUserRow>(
          `
            SELECT id, user_no, email, status
            FROM public."user"
            WHERE id = $1
            FOR UPDATE
          `,
          [normalizedUserId],
        );
        const user = locked.rows[0];
        if (!user) {
          throw new AdminAccessError(
            404,
            "RESOURCE_NOT_FOUND",
            "User was not found",
          );
        }
        if (user.status === "deleted") {
          throw new AdminAccessError(
            409,
            "USER_DELETION_ALREADY_REQUESTED",
            "User deletion has already been requested",
          );
        }
        const userNumber = toSafeUserNumber(user.user_no);
        if (request.confirmUserNumber !== userNumber) {
          throw new AdminAccessError(
            409,
            "USER_DELETION_CONFIRMATION_MISMATCH",
            "The confirmation user number does not match",
          );
        }

        const personalWorkspaces = await client.query<{ id: string }>(
          `
            SELECT id::text
            FROM public.workspaces
            WHERE owner_user_id = $1
              AND type = 'personal'
              AND status <> 'deleted'
            FOR UPDATE
          `,
          [normalizedUserId],
        );
        const ownedTeams = await client.query<OwnedTeamRow>(
          `
            SELECT id::text, name
            FROM public.workspaces
            WHERE owner_user_id = $1
              AND type = 'team'
              AND status <> 'deleted'
            FOR UPDATE
          `,
          [normalizedUserId],
        );
        const transfers = new Map(
          request.ownershipTransfers.map((transfer) => [
            transfer.workspaceId,
            transfer.successorUserId,
          ]),
        );
        if (
          transfers.size !== ownedTeams.rows.length ||
          ownedTeams.rows.some((team) => !transfers.has(team.id))
        ) {
          throw new AdminAccessError(
            409,
            "TEAM_OWNERSHIP_TRANSFER_REQUIRED",
            "Every owned team requires an active successor",
          );
        }

        for (const team of ownedTeams.rows) {
          const successorUserId = transfers.get(team.id)!;
          const successor = await client.query<{ id: string }>(
            `
              SELECT wm.user_id AS id
              FROM public.workspace_members wm
              JOIN public."user" u ON u.id = wm.user_id
              WHERE wm.workspace_id = $1
                AND wm.user_id = $2
                AND wm.user_id <> $3
                AND u.status = 'active'
              FOR UPDATE OF wm
            `,
            [team.id, successorUserId, normalizedUserId],
          );
          if (!successor.rows[0]) {
            throw new AdminAccessError(
              409,
              "TEAM_OWNERSHIP_TRANSFER_INVALID",
              "A team successor must be an active member of that team",
            );
          }
          await client.query(
            `
              UPDATE public.workspaces
              SET owner_user_id = $2, updated_at = now()
              WHERE id = $1
            `,
            [team.id, successorUserId],
          );
          await client.query(
            `
              UPDATE public.workspace_members
              SET role = 'owner'
              WHERE workspace_id = $1 AND user_id = $2
            `,
            [team.id, successorUserId],
          );
        }

        // Migration records require their creator to remain a workspace member.
        await client.query(
          `
            UPDATE public.migration_imports mi
            SET created_by_user_id = w.owner_user_id,
                updated_at = now()
            FROM public.workspaces w
            WHERE w.id = mi.workspace_id
              AND w.type = 'team'
              AND mi.created_by_user_id = $1
          `,
          [normalizedUserId],
        );
        await client.query(
          `
            UPDATE public.migration_exports me
            SET created_by_user_id = w.owner_user_id,
                updated_at = now()
            FROM public.workspaces w
            WHERE w.id = me.workspace_id
              AND w.type = 'team'
              AND me.created_by_user_id = $1
          `,
          [normalizedUserId],
        );
        await client.query(
          `
            DELETE FROM public.workspace_user_state wus
            USING public.workspaces w
            WHERE wus.workspace_id = w.id
              AND wus.user_id = $1
              AND w.type = 'team'
          `,
          [normalizedUserId],
        );
        const removedMemberships = await client.query(
          `
            DELETE FROM public.workspace_members wm
            USING public.workspaces w
            WHERE wm.workspace_id = w.id
              AND wm.user_id = $1
              AND w.type = 'team'
          `,
          [normalizedUserId],
        );

        const personalWorkspaceIds = personalWorkspaces.rows.map(
          (workspace) => workspace.id,
        );
        if (personalWorkspaceIds.length > 0) {
          await client.query(
            `DELETE FROM public.workspace_user_state WHERE user_id = $1 AND workspace_id = ANY($2::uuid[])`,
            [normalizedUserId, personalWorkspaceIds],
          );
          await client.query(
            `DELETE FROM public.asset_references WHERE workspace_id = ANY($1::uuid[])`,
            [personalWorkspaceIds],
          );
          await client.query(
            `
              DELETE FROM public.project_snapshots ps
              USING public.projects p
              WHERE ps.project_id = p.id
                AND p.workspace_id = ANY($1::uuid[])
            `,
            [personalWorkspaceIds],
          );
          await client.query(
            `
              UPDATE public.project_edges pe
              SET deleted_at = COALESCE(
                    pe.deleted_at,
                    GREATEST($2::timestamptz, pe.created_at)
                  ),
                  updated_at = now()
              FROM public.projects p
              WHERE pe.project_id = p.id
                AND p.workspace_id = ANY($1::uuid[])
            `,
            [personalWorkspaceIds, deletedAt.toISOString()],
          );
          await client.query(
            `
              UPDATE public.project_nodes pn
              SET deleted_at = COALESCE(
                    pn.deleted_at,
                    GREATEST($2::timestamptz, pn.created_at)
                  ),
                  updated_at = now()
              FROM public.projects p
              WHERE pn.project_id = p.id
                AND p.workspace_id = ANY($1::uuid[])
            `,
            [personalWorkspaceIds, deletedAt.toISOString()],
          );
          await client.query(
            `
              UPDATE public.projects p
              SET deleted_at = COALESCE(
                    p.deleted_at,
                    GREATEST($2::timestamptz, p.created_at)
                  ),
                  updated_at = now()
              WHERE p.workspace_id = ANY($1::uuid[])
            `,
            [personalWorkspaceIds, deletedAt.toISOString()],
          );
          await client.query(
            `
              UPDATE public.assets a
              SET status = 'deleted',
                  deleted_at = COALESCE(
                    a.deleted_at,
                    GREATEST($2::timestamptz, a.created_at)
                  ),
                  updated_at = now()
              WHERE a.workspace_id = ANY($1::uuid[])
            `,
            [personalWorkspaceIds, deletedAt.toISOString()],
          );
          await client.query(
            `DELETE FROM public.asset_uploads WHERE workspace_id = ANY($1::uuid[])`,
            [personalWorkspaceIds],
          );
          await client.query(
            `
              UPDATE public.workspaces
              SET status = 'deleted', updated_at = now()
              WHERE id = ANY($1::uuid[])
            `,
            [personalWorkspaceIds],
          );
        }

        const challengeHashes = [
          emailChallengeHash(
            options.ordinaryAuthSecret,
            "registration-email",
            user.email,
          ),
          emailChallengeHash(
            options.ordinaryAuthSecret,
            "password-reset-email",
            user.email,
          ),
        ];
        await client.query(`DELETE FROM public."session" WHERE user_id = $1`, [
          normalizedUserId,
        ]);
        await client.query(
          `DELETE FROM public.auth_devices WHERE user_id = $1`,
          [normalizedUserId],
        );
        await client.query(`DELETE FROM public."account" WHERE user_id = $1`, [
          normalizedUserId,
        ]);
        await client.query(
          `DELETE FROM public."verification" WHERE identifier = $1`,
          [user.email],
        );
        await client.query(
          `DELETE FROM public.generation_telemetry WHERE user_id = $1`,
          [normalizedUserId],
        );
        await client.query(
          `DELETE FROM public.registration_email_challenges WHERE email_hash = $1`,
          [challengeHashes[0]],
        );
        await client.query(
          `DELETE FROM public.password_reset_email_challenges WHERE email_hash = $1`,
          [challengeHashes[1]],
        );

        const tombstoneUsername = deletedUsername(normalizedUserId);
        await client.query(
          `
            UPDATE public."user"
            SET status = 'deleted',
                deleted_at = COALESCE(deleted_at, $2::timestamptz),
                email = $3,
                email_verified = false,
                username = $4,
                display_username = $5,
                name = $5,
                image = NULL,
                updated_at = now()
            WHERE id = $1
          `,
          [
            normalizedUserId,
            deletedAt.toISOString(),
            `deleted-${userNumber}@deleted.invalid`,
            tombstoneUsername,
            `Deleted_${tombstoneUsername.slice("deleted_".length)}`,
          ],
        );
        await client.query(
          `
            INSERT INTO public.account_erasure_jobs (
              user_id, personal_workspace_ids, purge_after
            ) VALUES ($1, $2::jsonb, $3::timestamptz)
          `,
          [
            normalizedUserId,
            JSON.stringify(personalWorkspaceIds),
            purgeAfter.toISOString(),
          ],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "user.deletion.requested",
            targetType: "user",
            targetId: normalizedUserId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            before: { status: user.status },
            after: {
              reason: request.reason,
              personalWorkspaceCount: personalWorkspaceIds.length,
              removedTeamMembershipCount: removedMemberships.rowCount ?? 0,
              ownershipTransfers: request.ownershipTransfers.map(
                (transfer) => ({
                  workspaceId: transfer.workspaceId,
                  successorUserId: transfer.successorUserId,
                }),
              ),
              purgeAfter: purgeAfter.toISOString(),
            },
          },
          options.auditSecret,
        );
        return {
          deletedAt: deletedAt.toISOString(),
          purgeAfter: purgeAfter.toISOString(),
          personalWorkspaceCount: personalWorkspaceIds.length,
          removedTeamMembershipCount: removedMemberships.rowCount ?? 0,
        };
      });
    },
  };
}
