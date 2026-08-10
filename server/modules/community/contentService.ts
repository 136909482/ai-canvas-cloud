import {
  COMMUNITY_CONSENT_VERSION,
  type CommunityPostResponse,
  type CommunityPostStatus,
  type CommunityPostSummary,
  type CommunityPublicPostsResponse,
  type CommunityPublicPostResponse,
  type CommunityReportReason,
  type CommunityReportResponse,
  type CreateCommunityPostRequest,
  type CreateCommunityReportRequest,
  type MyCommunityPostsResponse,
} from "@ai-canvas-cloud/contracts";
import type { DbClient, DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_REASONS = new Set<CommunityReportReason>([
  "inappropriate",
  "copyright",
  "privacy",
  "spam",
  "other",
]);

export interface CommunityActor {
  userId: string;
  workspaceId: string;
}

interface CommunityPostRow {
  id: string;
  author_user_id: string;
  source_workspace_id: string;
  asset_id: string;
  title: string;
  status: CommunityPostStatus;
  moderation_reason: string | null;
  submission_idempotency_key: string;
  published_at: Date | string | null;
  withdrawn_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  tags: string[] | null;
}

interface CommunityReportRow {
  id: string;
  post_id: string;
  reason: CommunityReportReason;
  status: "pending" | "resolved" | "dismissed";
  created_at: Date | string;
  resolved_at: Date | string | null;
}

export interface CommunityContentService {
  listPublic(input: {
    query?: string | null;
    tag?: string | null;
    cursor?: string | null;
  }): Promise<CommunityPublicPostsResponse>;
  getPublic(postId: string): Promise<CommunityPublicPostResponse>;
  create(
    input: CreateCommunityPostRequest,
    actor: CommunityActor,
  ): Promise<CommunityPostResponse>;
  listMine(
    actor: CommunityActor,
    cursor?: string | null,
  ): Promise<MyCommunityPostsResponse>;
  withdraw(
    postId: string,
    actor: CommunityActor,
  ): Promise<CommunityPostResponse>;
  report(
    postId: string,
    input: CreateCommunityReportRequest,
    actor: CommunityActor,
  ): Promise<CommunityReportResponse>;
}

function error(
  statusCode: number,
  apiCode:
    | "VALIDATION_FAILED"
    | "ACCESS_DENIED"
    | "COMMUNITY_POST_NOT_FOUND"
    | "COMMUNITY_ASSET_NOT_ALLOWED"
    | "COMMUNITY_POST_STATE_INVALID"
    | "COMMUNITY_POST_DUPLICATE"
    | "COMMUNITY_REPORT_RATE_LIMITED",
  message: string,
): never {
  throw new AuthServiceError({ statusCode, apiCode, message });
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) {
    error(400, "VALIDATION_FAILED", "Tags must contain at most 8 items");
  }
  const tags = value.map((item) => {
    if (typeof item !== "string")
      error(400, "VALIDATION_FAILED", "Every tag must be a string");
    const normalized = item.trim().replace(/\s+/gu, " ").toLowerCase();
    if (normalized.length < 1 || normalized.length > 24) {
      error(400, "VALIDATION_FAILED", "Tags must be 1 to 24 characters");
    }
    return normalized;
  });
  return [...new Set(tags)];
}

function validateCreate(input: CreateCommunityPostRequest) {
  if (!input || typeof input !== "object" || !UUID_PATTERN.test(input.assetId))
    error(400, "VALIDATION_FAILED", "assetId must be a UUID");
  const title = input.title?.trim().replace(/\s+/gu, " ");
  if (!title || title.length > 120)
    error(400, "VALIDATION_FAILED", "Title must be 1 to 120 characters");
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128)
    error(400, "VALIDATION_FAILED", "Idempotency key is invalid");
  return {
    assetId: input.assetId.toLowerCase(),
    title,
    tags: normalizeTags(input.tags),
    idempotencyKey,
  };
}

function toIso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

function postSummary(row: CommunityPostRow): CommunityPostSummary {
  return {
    id: row.id,
    assetId: row.asset_id,
    title: row.title,
    tags: row.tags ?? [],
    status: row.status,
    moderationReason: row.moderation_reason,
    publishedAt: toIso(row.published_at),
    withdrawnAt: toIso(row.withdrawn_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const POST_SELECT = `
  SELECT p.*, COALESCE(array_agg(t.tag ORDER BY t.tag)
    FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
  FROM community_posts p
  LEFT JOIN community_post_tags t ON t.post_id = p.id`;

async function readPost(client: Pick<DbClient, "query">, postId: string) {
  const result = await client.query<CommunityPostRow>(
    `${POST_SELECT} WHERE p.id = $1 GROUP BY p.id`,
    [postId],
  );
  return result.rows[0];
}

function decodeCursor(cursor?: string | null) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { createdAt?: unknown; id?: unknown };
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id) ||
      Number.isNaN(Date.parse(parsed.createdAt))
    )
      throw new Error();
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    error(400, "VALIDATION_FAILED", "Community post cursor is invalid");
  }
}

function encodeCursor(row: CommunityPostRow) {
  return Buffer.from(
    JSON.stringify({
      createdAt: new Date(row.created_at).toISOString(),
      id: row.id,
    }),
  ).toString("base64url");
}

interface PublicPostRow extends CommunityPostRow {
  public_nickname: string | null;
}

function publicSummary(row: PublicPostRow) {
  if (!row.public_nickname || !row.published_at) return null;
  return {
    id: row.id,
    assetId: row.asset_id,
    title: row.title,
    tags: row.tags ?? [],
    publishedAt: new Date(row.published_at).toISOString(),
    publicNickname: row.public_nickname,
  };
}

export function createPostgresCommunityContentService(
  pool: DbPool,
): CommunityContentService {
  return {
    async listPublic(input) {
      const cursor = decodeCursor(input.cursor);
      const values: unknown[] = [];
      const clauses = [
        "p.status = 'published'",
        "p.published_at IS NOT NULL",
        "profile.profile_status = 'active'",
      ];
      if (input.query?.trim()) {
        values.push(
          `%${input.query.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
        );
        clauses.push(`p.title ILIKE $${values.length} ESCAPE '\\'`);
      }
      if (input.tag?.trim()) {
        values.push(input.tag.trim().toLowerCase());
        clauses.push(
          `EXISTS (SELECT 1 FROM community_post_tags filter_tag WHERE filter_tag.post_id = p.id AND filter_tag.tag = $${values.length})`,
        );
      }
      if (cursor) {
        values.push(cursor.createdAt, cursor.id);
        clauses.push(
          `(p.created_at, p.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
        );
      }
      values.push(51);
      const result = await pool.query<PublicPostRow>(
        `SELECT p.*, profile.public_nickname,
           COALESCE(array_agg(t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
         FROM community_posts p
         JOIN user_public_profiles profile ON profile.user_id = p.author_user_id
         LEFT JOIN community_post_tags t ON t.post_id = p.id
         WHERE ${clauses.join(" AND ")}
         GROUP BY p.id, profile.public_nickname
         ORDER BY p.created_at DESC, p.id DESC LIMIT $${values.length}`,
        values,
      );
      const page = result.rows.slice(0, 50).flatMap((row) => {
        const post = publicSummary(row);
        return post ? [post] : [];
      });
      return {
        items: page,
        nextCursor:
          result.rows.length > 50 && page.at(-1)
            ? encodeCursor(result.rows[page.length - 1]!)
            : null,
      };
    },
    async getPublic(postId) {
      if (!UUID_PATTERN.test(postId))
        error(404, "COMMUNITY_POST_NOT_FOUND", "Community post was not found");
      const result = await pool.query<PublicPostRow>(
        `SELECT p.*, profile.public_nickname,
           COALESCE(array_agg(t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
         FROM community_posts p
         JOIN user_public_profiles profile ON profile.user_id = p.author_user_id
         LEFT JOIN community_post_tags t ON t.post_id = p.id
         WHERE p.id = $1 AND p.status = 'published' AND p.published_at IS NOT NULL AND profile.profile_status = 'active'
         GROUP BY p.id, profile.public_nickname`,
        [postId],
      );
      const post = result.rows[0] ? publicSummary(result.rows[0]) : null;
      if (!post)
        error(404, "COMMUNITY_POST_NOT_FOUND", "Community post was not found");
      return { post };
    },
    async create(input, actor) {
      const submitted = validateCreate(input);
      return withTransaction(pool, async (client) => {
        const profile = await client.query<{
          public_nickname: string | null;
          profile_status: string;
          community_consent_version: number | null;
          user_status: string;
        }>(
          `SELECT p.public_nickname, p.profile_status, p.community_consent_version,
                  COALESCE(u.status, 'active') AS user_status
           FROM "user" u
           LEFT JOIN user_public_profiles p ON p.user_id = u.id
           WHERE u.id = $1 FOR UPDATE OF u`,
          [actor.userId],
        );
        const eligible = profile.rows[0];
        if (!eligible || eligible.user_status !== "active")
          error(403, "ACCESS_DENIED", "Active account required");
        if (
          eligible.profile_status !== "active" ||
          eligible.community_consent_version !== COMMUNITY_CONSENT_VERSION ||
          !eligible.public_nickname
        ) {
          error(
            403,
            "ACCESS_DENIED",
            "Public nickname and current contribution consent are required",
          );
        }

        const asset = await client.query<{
          status: string;
          mime_type: string;
          member_role: string;
          workspace_status: string;
        }>(
          `SELECT a.status, a.mime_type, wm.role AS member_role, w.status AS workspace_status
           FROM assets a
           JOIN workspaces w ON w.id = a.workspace_id
           JOIN workspace_members wm ON wm.workspace_id = a.workspace_id AND wm.user_id = $3
           WHERE a.id = $1 AND a.workspace_id = $2 AND a.created_by_user_id = $3
           FOR UPDATE OF a, w, wm`,
          [submitted.assetId, actor.workspaceId, actor.userId],
        );
        const allowed = asset.rows[0];
        if (
          !allowed ||
          allowed.status !== "completed" ||
          allowed.workspace_status !== "active" ||
          allowed.member_role === "viewer" ||
          !allowed.mime_type.toLowerCase().startsWith("image/")
        ) {
          error(
            403,
            "COMMUNITY_ASSET_NOT_ALLOWED",
            "Only your completed image assets in the current workspace can be submitted",
          );
        }

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO community_posts (
             author_user_id, source_workspace_id, asset_id, title,
             submission_idempotency_key
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (author_user_id, submission_idempotency_key) DO NOTHING
           RETURNING id`,
          [
            actor.userId,
            actor.workspaceId,
            submitted.assetId,
            submitted.title,
            submitted.idempotencyKey,
          ],
        );
        const postId = inserted.rows[0]?.id;
        if (!postId) {
          const existing = await client.query<Pick<CommunityPostRow, "id">>(
            `SELECT id FROM community_posts
             WHERE author_user_id = $1 AND submission_idempotency_key = $2
             FOR UPDATE`,
            [actor.userId, submitted.idempotencyKey],
          );
          const row = existing.rows[0]
            ? await readPost(client, existing.rows[0].id)
            : undefined;
          if (
            !row ||
            row.asset_id !== submitted.assetId ||
            row.title !== submitted.title ||
            JSON.stringify(row.tags ?? []) !==
              JSON.stringify([...submitted.tags].sort())
          ) {
            error(
              409,
              "COMMUNITY_POST_DUPLICATE",
              "Idempotency key was already used for another submission",
            );
          }
          return { post: postSummary(row) };
        }
        if (submitted.tags.length > 0) {
          await client.query(
            `INSERT INTO community_post_tags (post_id, tag)
             SELECT $1, unnest($2::text[])`,
            [postId, submitted.tags],
          );
        }
        const row = await readPost(client, postId);
        return { post: postSummary(row!) };
      });
    },

    async listMine(actor, cursorValue) {
      const cursor = decodeCursor(cursorValue);
      const values: unknown[] = [actor.userId];
      let cursorClause = "";
      if (cursor) {
        values.push(cursor.createdAt, cursor.id);
        cursorClause = `AND (p.created_at, p.id) < ($2::timestamptz, $3::uuid)`;
      }
      values.push(51);
      const result = await pool.query<CommunityPostRow>(
        `${POST_SELECT}
         WHERE p.author_user_id = $1 ${cursorClause}
         GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC
         LIMIT $${values.length}`,
        values,
      );
      const page = result.rows.slice(0, 50);
      return {
        items: page.map(postSummary),
        nextCursor:
          result.rows.length > 50 && page.at(-1)
            ? encodeCursor(page.at(-1)!)
            : null,
      };
    },

    async withdraw(postIdValue, actor) {
      if (!UUID_PATTERN.test(postIdValue))
        error(404, "COMMUNITY_POST_NOT_FOUND", "Community post was not found");
      return withTransaction(pool, async (client) => {
        const current = await client.query<{
          id: string;
          status: CommunityPostStatus;
        }>(
          `SELECT p.id, p.status FROM community_posts p
           JOIN workspace_members wm ON wm.workspace_id = p.source_workspace_id AND wm.user_id = $3
           WHERE p.id = $1 AND p.author_user_id = $2 AND p.source_workspace_id = $4
           FOR UPDATE OF p`,
          [postIdValue, actor.userId, actor.userId, actor.workspaceId],
        );
        if (!current.rows[0])
          error(
            404,
            "COMMUNITY_POST_NOT_FOUND",
            "Community post was not found",
          );
        if (!["pending_review", "published"].includes(current.rows[0].status))
          error(
            409,
            "COMMUNITY_POST_STATE_INVALID",
            "Community post cannot be withdrawn from its current state",
          );
        await client.query(
          `UPDATE community_posts SET status = 'withdrawn', moderation_reason = NULL,
             withdrawn_at = now(), updated_at = now() WHERE id = $1`,
          [postIdValue],
        );
        const row = await readPost(client, postIdValue);
        return { post: postSummary(row!) };
      });
    },

    async report(postIdValue, input, actor) {
      if (!UUID_PATTERN.test(postIdValue))
        error(404, "COMMUNITY_POST_NOT_FOUND", "Community post was not found");
      if (!input || !REPORT_REASONS.has(input.reason))
        error(400, "VALIDATION_FAILED", "Report reason is invalid");
      const detail = input.detail?.trim() || null;
      if (detail && detail.length > 500)
        error(400, "VALIDATION_FAILED", "Report detail is too long");
      return withTransaction(pool, async (client) => {
        const post = await client.query<{
          author_user_id: string;
          status: CommunityPostStatus;
        }>(
          `SELECT author_user_id, status FROM community_posts WHERE id = $1 FOR UPDATE`,
          [postIdValue],
        );
        if (!post.rows[0])
          error(
            404,
            "COMMUNITY_POST_NOT_FOUND",
            "Community post was not found",
          );
        if (
          post.rows[0].status !== "published" ||
          post.rows[0].author_user_id === actor.userId
        )
          error(
            409,
            "COMMUNITY_POST_STATE_INVALID",
            "Only another user's published post can be reported",
          );
        const recent = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM community_reports
           WHERE reporter_user_id = $1 AND created_at >= now() - interval '24 hours'`,
          [actor.userId],
        );
        if (Number(recent.rows[0]?.count ?? 0) >= 10)
          error(
            429,
            "COMMUNITY_REPORT_RATE_LIMITED",
            "Daily community report limit reached",
          );
        try {
          const created = await client.query<CommunityReportRow>(
            `INSERT INTO community_reports (post_id, reporter_user_id, reason, detail)
             VALUES ($1, $2, $3, $4)
             RETURNING id, post_id, reason, status, created_at, resolved_at`,
            [postIdValue, actor.userId, input.reason, detail],
          );
          const row = created.rows[0]!;
          return {
            report: {
              id: row.id,
              postId: row.post_id,
              reason: row.reason,
              status: row.status,
              createdAt: new Date(row.created_at).toISOString(),
              resolvedAt: toIso(row.resolved_at),
            },
          };
        } catch (caught) {
          if (
            (caught as { code?: string; constraint?: string }).constraint ===
            "community_reports_pending_unique"
          )
            error(
              429,
              "COMMUNITY_REPORT_RATE_LIMITED",
              "This post already has a pending report from you",
            );
          throw caught;
        }
      });
    },
  };
}

export function createUnavailableCommunityContentService(): CommunityContentService {
  const unavailable = async (): Promise<never> => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: "SERVICE_UNAVAILABLE",
      message: "Community content service is unavailable",
      retryable: true,
    });
  };
  return {
    listPublic: unavailable,
    getPublic: unavailable,
    create: unavailable,
    listMine: unavailable,
    withdraw: unavailable,
    report: unavailable,
  };
}
