import type {
  AdminAnnouncement,
  AdminAnnouncementsResponse,
  AnnouncementActionResponse,
  AnnouncementCategory,
  AnnouncementTimelineResponse,
  MarkAnnouncementsReadResponse,
  SaveAnnouncementDraftRequest,
} from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import type { AdminRequestContext, AdminService } from "../admin/index.js";
import { AdminAccessError, insertAdminAuditEvent } from "../admin/index.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set<AnnouncementCategory>([
  "notice",
  "product_update",
  "maintenance",
]);

interface AnnouncementRow {
  id: string;
  category: AnnouncementCategory;
  status: "draft" | "published" | "archived";
  title: string;
  content: string;
  published_at: Date | string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TimelineRow extends AnnouncementRow {
  read_at: Date | string | null;
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

function toAdminAnnouncement(row: AnnouncementRow): AdminAnnouncement {
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    title: row.title,
    content: row.content,
    publishedAt: row.published_at ? iso(row.published_at) : null,
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function validateId(value: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "Announcement ID is invalid",
    );
  }
  return value.toLowerCase();
}

function validateDraft(input: SaveAnnouncementDraftRequest) {
  if (!input || typeof input !== "object") {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "Announcement draft is required",
    );
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["category", "title", "content"].includes(key))) {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "Announcement draft contains unsupported fields",
    );
  }
  const category = input.category;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (
    !CATEGORIES.has(category) ||
    title.length < 1 ||
    title.length > 120 ||
    content.length < 1 ||
    content.length > 4000
  ) {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "Announcement category, title, or content is invalid",
    );
  }
  return { category, title, content };
}

export interface AnnouncementTimelineService {
  list(userId: string): Promise<AnnouncementTimelineResponse>;
  markRead(
    userId: string,
    announcementIds: string[],
  ): Promise<MarkAnnouncementsReadResponse>;
}

export interface AdminAnnouncementService {
  list(context: AdminRequestContext): Promise<AdminAnnouncementsResponse>;
  createDraft(
    input: SaveAnnouncementDraftRequest,
    context: AdminRequestContext,
  ): Promise<AnnouncementActionResponse>;
  updateDraft(
    id: string,
    input: SaveAnnouncementDraftRequest,
    context: AdminRequestContext,
  ): Promise<AnnouncementActionResponse>;
  publish(
    id: string,
    context: AdminRequestContext,
  ): Promise<AnnouncementActionResponse>;
  archive(
    id: string,
    context: AdminRequestContext,
  ): Promise<AnnouncementActionResponse>;
}

export function createPostgresAnnouncementTimelineService(
  pool: DbPool,
): AnnouncementTimelineService {
  return {
    async list(userId) {
      const [result, unread] = await Promise.all([
        pool.query<TimelineRow>(
          `SELECT a.id, a.category, a.status, a.title, a.content, a.published_at,
                  a.archived_at, a.created_at, a.updated_at, r.read_at
           FROM announcements a
           LEFT JOIN announcement_receipts r
             ON r.announcement_id = a.id AND r.user_id = $1
           WHERE a.status = 'published' AND a.published_at <= now()
           ORDER BY a.published_at DESC, a.id DESC
           LIMIT 100`,
          [userId],
        ),
        pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM announcements a
           WHERE a.status = 'published' AND a.published_at <= now()
             AND NOT EXISTS (
               SELECT 1 FROM announcement_receipts r
               WHERE r.announcement_id = a.id AND r.user_id = $1
             )`,
          [userId],
        ),
      ]);
      const items = result.rows.map((row) => ({
        id: row.id,
        category: row.category,
        title: row.title,
        content: row.content,
        publishedAt: iso(row.published_at!),
        readAt: row.read_at ? iso(row.read_at) : null,
      }));
      return { items, unreadCount: Number(unread.rows[0]?.count ?? 0) };
    },
    async markRead(userId, announcementIds) {
      if (
        !Array.isArray(announcementIds) ||
        announcementIds.length < 1 ||
        announcementIds.length > 100 ||
        announcementIds.some(
          (id) => typeof id !== "string" || !UUID_PATTERN.test(id),
        )
      ) {
        throw new AuthServiceError({
          statusCode: 400,
          apiCode: "VALIDATION_FAILED",
          message: "announcementIds must contain 1 to 100 UUIDs",
        });
      }
      const ids = [...new Set(announcementIds.map((id) => id.toLowerCase()))];
      const readAt = new Date();
      const result = await pool.query(
        `INSERT INTO announcement_receipts (announcement_id, user_id, read_at)
         SELECT id, $1, $3 FROM announcements
         WHERE id = ANY($2::uuid[]) AND status = 'published' AND published_at <= now()
         ON CONFLICT (announcement_id, user_id) DO NOTHING`,
        [userId, ids, readAt],
      );
      return {
        readAt: readAt.toISOString(),
        updatedCount: result.rowCount ?? 0,
      };
    },
  };
}

export function createUnavailableAnnouncementTimelineService(): AnnouncementTimelineService {
  const unavailable = async (): Promise<never> => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: "SERVICE_UNAVAILABLE",
      message: "Announcement service is unavailable",
      retryable: true,
    });
  };
  return { list: unavailable, markRead: unavailable };
}

export function createPostgresAdminAnnouncementService(
  pool: DbPool,
  options: { adminService: AdminService; auditSecret: string },
): AdminAnnouncementService {
  async function mutate(
    idValue: string,
    context: AdminRequestContext,
    action: "publish" | "archive",
  ) {
    const id = validateId(idValue);
    const session = await options.adminService.requirePermission(
      context,
      "announcement.write",
    );
    return withTransaction(pool, async (client) => {
      const before = await client.query<AnnouncementRow>(
        `SELECT * FROM public.announcements WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const current = before.rows[0];
      if (!current)
        throw new AdminAccessError(
          404,
          "RESOURCE_NOT_FOUND",
          "Announcement was not found",
        );
      if (
        (action === "publish" && current.status !== "draft") ||
        (action === "archive" && current.status !== "published")
      ) {
        throw new AdminAccessError(
          409,
          "VALIDATION_FAILED",
          `Announcement cannot be ${action}ed from its current status`,
        );
      }
      const updated = await client.query<AnnouncementRow>(
        action === "publish"
          ? `UPDATE public.announcements SET status = 'published', published_at = now(), updated_at = now(), updated_by_admin_id = $2 WHERE id = $1 RETURNING *`
          : `UPDATE public.announcements SET status = 'archived', archived_at = now(), updated_at = now(), updated_by_admin_id = $2 WHERE id = $1 RETURNING *`,
        [id, session.admin.id],
      );
      const row = updated.rows[0]!;
      await insertAdminAuditEvent(
        client,
        {
          actor: session.admin,
          action: `announcement.${action}ed`,
          targetType: "announcement",
          targetId: id,
          result: "success",
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          before: { status: current.status },
          after: { status: row.status, category: row.category },
        },
        options.auditSecret,
      );
      return { announcement: toAdminAnnouncement(row) };
    });
  }

  return {
    async list(context) {
      await options.adminService.requirePermission(
        context,
        "announcement.write",
      );
      const result = await pool.query<AnnouncementRow>(
        `SELECT * FROM public.announcements ORDER BY created_at DESC, id DESC LIMIT 200`,
      );
      return { items: result.rows.map(toAdminAnnouncement) };
    },
    async createDraft(input, context) {
      const draft = validateDraft(input);
      const session = await options.adminService.requirePermission(
        context,
        "announcement.write",
      );
      return withTransaction(pool, async (client) => {
        const result = await client.query<AnnouncementRow>(
          `INSERT INTO public.announcements (category, title, content, created_by_admin_id, updated_by_admin_id)
           VALUES ($1, $2, $3, $4, $4) RETURNING *`,
          [draft.category, draft.title, draft.content, session.admin.id],
        );
        const row = result.rows[0]!;
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "announcement.draft_created",
            targetType: "announcement",
            targetId: row.id,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: { status: row.status, category: row.category },
          },
          options.auditSecret,
        );
        return { announcement: toAdminAnnouncement(row) };
      });
    },
    async updateDraft(idValue, input, context) {
      const id = validateId(idValue);
      const draft = validateDraft(input);
      const session = await options.adminService.requirePermission(
        context,
        "announcement.write",
      );
      return withTransaction(pool, async (client) => {
        const result = await client.query<AnnouncementRow>(
          `UPDATE public.announcements SET category = $2, title = $3, content = $4, updated_by_admin_id = $5, updated_at = now()
           WHERE id = $1 AND status = 'draft' RETURNING *`,
          [id, draft.category, draft.title, draft.content, session.admin.id],
        );
        if (!result.rows[0])
          throw new AdminAccessError(
            409,
            "VALIDATION_FAILED",
            "Only draft announcements can be edited",
          );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "announcement.draft_updated",
            targetType: "announcement",
            targetId: id,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: { status: "draft", category: draft.category },
          },
          options.auditSecret,
        );
        return { announcement: toAdminAnnouncement(result.rows[0]) };
      });
    },
    publish: (id, context) => mutate(id, context, "publish"),
    archive: (id, context) => mutate(id, context, "archive"),
  };
}

export function createUnavailableAdminAnnouncementService(): AdminAnnouncementService {
  const unavailable = async (): Promise<never> => {
    throw new Error("Announcement service is unavailable");
  };
  return {
    list: unavailable,
    createDraft: unavailable,
    updateDraft: unavailable,
    publish: unavailable,
    archive: unavailable,
  };
}
