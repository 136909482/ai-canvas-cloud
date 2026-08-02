import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresAnnouncementTimelineService } from "./service.ts";

test("announcement timeline returns published items with per-user read state", async () => {
  const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (sql.includes("count(*)"))
        return { rows: [{ count: "2" }], rowCount: 1 };
      return {
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            category: "product_update",
            status: "published",
            title: "模型列表更新",
            content: "新增图像模型",
            published_at: new Date("2026-08-02T00:00:00.000Z"),
            archived_at: null,
            created_at: new Date("2026-08-02T00:00:00.000Z"),
            updated_at: new Date("2026-08-02T00:00:00.000Z"),
            read_at: null,
          },
        ],
        rowCount: 1,
      };
    },
  };
  const service = createPostgresAnnouncementTimelineService(pool as never);
  const result = await service.list("user-a");

  assert.equal(result.unreadCount, 2);
  assert.deepEqual(result.items[0], {
    id: "11111111-1111-4111-8111-111111111111",
    category: "product_update",
    title: "模型列表更新",
    content: "新增图像模型",
    publishedAt: "2026-08-02T00:00:00.000Z",
    readAt: null,
  });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0]?.values, ["user-a"]);
});

test("marking announcements read validates IDs and inserts only published rows", async () => {
  let captured: { sql: string; values?: unknown[] } | null = null;
  const pool = {
    async query(sql: string, values?: unknown[]) {
      captured = { sql, values };
      return { rows: [], rowCount: 1 };
    },
  };
  const service = createPostgresAnnouncementTimelineService(pool as never);
  await assert.rejects(
    service.markRead("user-a", ["not-a-uuid"]),
    /announcementIds/,
  );

  const id = "11111111-1111-4111-8111-111111111111";
  const result = await service.markRead("user-a", [id, id]);
  assert.equal(result.updatedCount, 1);
  assert.match(captured!.sql, /status = 'published'/);
  assert.deepEqual(captured!.values?.slice(0, 2), ["user-a", [id]]);
});
