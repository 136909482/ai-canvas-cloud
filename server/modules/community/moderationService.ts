import type {
  AdminCommunityPostSummary,
  AdminCommunityPostsResponse,
  AdminCommunityReportsResponse,
  CommunityPostStatus,
  CommunityPostResponse,
  ModerateCommunityPostRequest,
  ResolveCommunityReportRequest,
  AdminCommunityUserVisibilityResponse,
} from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import { insertAdminAuditEvent } from "../admin/adminAudit.js";
import { AdminAccessError } from "../admin/security.js";
import type { AdminRequestContext } from "../admin/types.js";
import type { AdminService } from "../admin/service.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POST_STATUSES = new Set<CommunityPostStatus>([
  "pending_review",
  "published",
  "rejected",
  "withdrawn",
  "removed",
]);

interface AdminPostRow {
  id: string;
  author_user_id: string;
  source_workspace_id: string;
  asset_id: string;
  title: string;
  status: CommunityPostStatus;
  moderation_reason: string | null;
  published_at: Date | string | null;
  withdrawn_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  public_nickname: string | null;
  profile_status: "active" | "hidden";
  tags: string[] | null;
}

interface AdminReportRow {
  id: string;
  post_id: string;
  reporter_user_id: string;
  reason: "inappropriate" | "copyright" | "privacy" | "spam" | "other";
  detail: string | null;
  status: "pending" | "resolved" | "dismissed";
  created_at: Date | string;
  resolved_at: Date | string | null;
}

export interface AdminCommunityModerationService {
  listPosts(
    status: CommunityPostStatus | undefined,
    context: AdminRequestContext,
  ): Promise<AdminCommunityPostsResponse>;
  approve(
    postId: string,
    context: AdminRequestContext,
  ): Promise<CommunityPostResponse>;
  reject(
    postId: string,
    input: ModerateCommunityPostRequest,
    context: AdminRequestContext,
  ): Promise<CommunityPostResponse>;
  remove(
    postId: string,
    input: ModerateCommunityPostRequest,
    context: AdminRequestContext,
  ): Promise<CommunityPostResponse>;
  listReports(
    context: AdminRequestContext,
  ): Promise<AdminCommunityReportsResponse>;
  resolveReport(
    reportId: string,
    input: ResolveCommunityReportRequest,
    context: AdminRequestContext,
  ): Promise<{ report: AdminCommunityReportsResponse["items"][number] }>;
  setUserVisibility(
    userId: string,
    hidden: boolean,
    context: AdminRequestContext,
  ): Promise<AdminCommunityUserVisibilityResponse>;
}

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

function toPost(row: AdminPostRow): AdminCommunityPostSummary {
  return {
    id: row.id,
    assetId: row.asset_id,
    title: row.title,
    tags: row.tags ?? [],
    status: row.status,
    moderationReason: row.moderation_reason,
    publishedAt: iso(row.published_at),
    withdrawnAt: iso(row.withdrawn_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    authorPublicNickname: row.public_nickname,
    authorUserId: row.author_user_id,
    authorProfileStatus: row.profile_status,
    sourceWorkspaceId: row.source_workspace_id,
  };
}

function toReport(row: AdminReportRow) {
  return {
    id: row.id,
    postId: row.post_id,
    reporterUserId: row.reporter_user_id,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    createdAt: iso(row.created_at)!,
    resolvedAt: iso(row.resolved_at),
  };
}

const ADMIN_POST_SELECT = `
  SELECT p.id, p.source_workspace_id, p.asset_id, p.title, p.status,
         p.moderation_reason, p.published_at, p.withdrawn_at,
         p.created_at, p.updated_at, profile.public_nickname, profile.profile_status,
         COALESCE(array_agg(t.tag ORDER BY t.tag)
           FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
  FROM public.community_posts p
  LEFT JOIN public.user_public_profiles profile ON profile.user_id = p.author_user_id
  LEFT JOIN public.community_post_tags t ON t.post_id = p.id`;

function validateId(value: string, type: "post" | "report") {
  if (!UUID_PATTERN.test(value)) {
    throw new AdminAccessError(
      404,
      type === "post"
        ? "COMMUNITY_POST_NOT_FOUND"
        : "COMMUNITY_REPORT_NOT_FOUND",
      type === "post"
        ? "Community post was not found"
        : "Community report was not found",
    );
  }
  return value.toLowerCase();
}

function validateReason(input: ModerateCommunityPostRequest) {
  const reason = input?.reason?.trim() ?? "";
  if (!reason || reason.length > 500) {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "A moderation reason of 1 to 500 characters is required",
    );
  }
  return reason;
}

export function createPostgresAdminCommunityModerationService(
  pool: DbPool,
  options: { adminService: AdminService; auditSecret: string },
): AdminCommunityModerationService {
  async function mutate(
    postIdValue: string,
    action: "approve" | "reject" | "remove",
    reason: string | null,
    context: AdminRequestContext,
  ) {
    const postId = validateId(postIdValue, "post");
    const session = await options.adminService.requirePermission(
      context,
      "community.moderate",
    );
    return withTransaction(pool, async (client) => {
      const locked = await client.query<Pick<AdminPostRow, "id" | "status">>(
        `SELECT id, status FROM public.community_posts WHERE id = $1 FOR UPDATE`,
        [postId],
      );
      const before = locked.rows[0];
      if (!before)
        throw new AdminAccessError(
          404,
          "COMMUNITY_POST_NOT_FOUND",
          "Community post was not found",
        );
      const allowed =
        action === "remove"
          ? before.status === "published"
          : before.status === "pending_review";
      if (!allowed)
        throw new AdminAccessError(
          409,
          "COMMUNITY_POST_STATE_INVALID",
          "Community post cannot be moderated from its current state",
        );
      const status: CommunityPostStatus =
        action === "approve"
          ? "published"
          : action === "reject"
            ? "rejected"
            : "removed";
      await client.query(
        `UPDATE public.community_posts
         SET status = $2,
             moderation_reason = $3,
             published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END,
             updated_at = now()
         WHERE id = $1`,
        [postId, status, reason],
      );
      await insertAdminAuditEvent(
        client,
        {
          actor: session.admin,
          action: `community.post.${action}`,
          targetType: "community_post",
          targetId: postId,
          result: "success",
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          before: { status: before.status },
          after: { status, moderationReasonProvided: reason !== null },
        },
        options.auditSecret,
      );
      const result = await client.query<AdminPostRow>(
        `${ADMIN_POST_SELECT} WHERE p.id = $1 GROUP BY p.id, profile.public_nickname, profile.profile_status`,
        [postId],
      );
      return { post: toPost(result.rows[0]!) };
    });
  }

  return {
    async listPosts(statusValue, context) {
      await options.adminService.requirePermission(
        context,
        "community.moderate",
      );
      const status = statusValue ?? "pending_review";
      if (!POST_STATUSES.has(status))
        throw new AdminAccessError(
          400,
          "VALIDATION_FAILED",
          "Community post status is invalid",
        );
      const result = await pool.query<AdminPostRow>(
        `${ADMIN_POST_SELECT} WHERE p.status = $1
         GROUP BY p.id, profile.public_nickname, profile.profile_status
         ORDER BY p.created_at ASC, p.id ASC LIMIT 200`,
        [status],
      );
      return { items: result.rows.map(toPost), nextCursor: null };
    },
    approve: (postId, context) => mutate(postId, "approve", null, context),
    reject: (postId, input, context) =>
      mutate(postId, "reject", validateReason(input), context),
    remove: (postId, input, context) =>
      mutate(postId, "remove", validateReason(input), context),
    async listReports(context) {
      await options.adminService.requirePermission(
        context,
        "community.moderate",
      );
      const result = await pool.query<AdminReportRow>(
        `SELECT id, post_id, reporter_user_id, reason, detail, status, created_at, resolved_at
         FROM public.community_reports WHERE status = 'pending'
         ORDER BY created_at ASC, id ASC LIMIT 200`,
      );
      return { items: result.rows.map(toReport), nextCursor: null };
    },
    async resolveReport(reportIdValue, input, context) {
      const reportId = validateId(reportIdValue, "report");
      if (!input || !["resolved", "dismissed"].includes(input.resolution))
        throw new AdminAccessError(
          400,
          "VALIDATION_FAILED",
          "Report resolution is invalid",
        );
      const session = await options.adminService.requirePermission(
        context,
        "community.moderate",
      );
      return withTransaction(pool, async (client) => {
        const updated = await client.query<AdminReportRow>(
          `UPDATE public.community_reports SET status = $2, resolved_at = now()
           WHERE id = $1 AND status = 'pending'
           RETURNING id, post_id, reporter_user_id, reason, detail, status, created_at, resolved_at`,
          [reportId, input.resolution],
        );
        const row = updated.rows[0];
        if (!row)
          throw new AdminAccessError(
            404,
            "COMMUNITY_REPORT_NOT_FOUND",
            "Pending community report was not found",
          );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "community.report.resolve",
            targetType: "community_report",
            targetId: reportId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            before: { status: "pending" },
            after: { status: input.resolution, reasonCode: row.reason },
          },
          options.auditSecret,
        );
        return { report: toReport(row) };
      });
    },
    async setUserVisibility(userId, hidden, context) {
      const session = await options.adminService.requirePermission(
        context,
        "community.moderate",
      );
      const result = await withTransaction(pool, async (client) => {
        const updated = await client.query<{
          profile_status: "active" | "hidden";
        }>(
          `UPDATE public.user_public_profiles SET profile_status = $2, updated_at = now()
           WHERE user_id = $1 RETURNING profile_status`,
          [userId, hidden ? "hidden" : "active"],
        );
        if (!updated.rows[0])
          throw new AdminAccessError(
            404,
            "RESOURCE_NOT_FOUND",
            "Community user profile was not found",
          );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: hidden ? "community.user.hide" : "community.user.unhide",
            targetType: "user",
            targetId: userId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: { profileStatus: updated.rows[0].profile_status },
          },
          options.auditSecret,
        );
        return updated.rows[0].profile_status;
      });
      return { userId, profileStatus: result };
    },
  };
}

export function createUnavailableAdminCommunityModerationService(): AdminCommunityModerationService {
  const unavailable = async (): Promise<never> => {
    throw new Error("Community moderation service is unavailable");
  };
  return {
    listPosts: unavailable,
    approve: unavailable,
    reject: unavailable,
    remove: unavailable,
    listReports: unavailable,
    resolveReport: unavailable,
    setUserVisibility: unavailable,
  };
}
