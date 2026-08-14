import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { isolateCurrentSchemaSql } from "../../dist/db/schemaBaseline.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresCommunityContentService } from "../../dist/modules/community/contentService.js";

loadDotEnv();
const databaseUrl = process.env.DATABASE_URL;

test(
  "PostgreSQL community content lists owned posts and enforces report lifecycle",
  { skip: databaseUrl ? false : "DATABASE_URL is not configured" },
  async () => {
    const schemaName = `community_content_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;
    const userId = "community-content-user";
    const reporterId = "community-content-reporter";
    const workspaceId = randomUUID();
    const reporterWorkspaceId = randomUUID();
    const assetId = randomUUID();
    const postId = randomUUID();
    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 2,
        options: `-c search_path=${schemaName},public`,
      });
      const migrationFiles = (
        await readdir(join(process.cwd(), "server", "db", "migrations"))
      )
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const fileName of migrationFiles) {
        await pool.query(
          isolateCurrentSchemaSql(
            await readFile(
              join(process.cwd(), "server", "db", "migrations", fileName),
              "utf8",
            ),
            schemaName,
          ),
        );
      }
      await pool.query(
        `
        INSERT INTO "user" (id, name, email, email_verified, user_no, username, display_username)
        VALUES ($1, 'Author', 'community-content-author@example.com', true, 10001, 'community_content_author', 'community_content_author'),
               ($2, 'Reporter', 'community-content-reporter@example.com', true, 10002, 'community_content_reporter', 'community_content_reporter')`,
        [userId, reporterId],
      );
      await pool.query(
        `INSERT INTO workspaces (id, name, owner_user_id) VALUES ($1, 'Community workspace', $2), ($3, 'Reporter workspace', $4)`,
        [workspaceId, userId, reporterWorkspaceId, reporterId],
      );
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`,
        [workspaceId, userId, reporterWorkspaceId, reporterId],
      );
      await pool.query(
        `INSERT INTO assets (id, workspace_id, created_by_user_id, object_key, mime_type, byte_size, asset_kind, status) VALUES ($1, $2, $3, 'community-content-test-image', 'image/png', 4, 'upload', 'completed')`,
        [assetId, workspaceId, userId],
      );
      await pool.query(
        `INSERT INTO user_public_profiles (user_id, public_nickname, community_consent_version, community_consent_at)
         VALUES ($1, 'Canvas Author', 1, now()), ($2, 'Canvas Reporter', 1, now())`,
        [userId, reporterId],
      );
      await pool.query(
        `INSERT INTO community_posts (id, author_user_id, source_workspace_id, asset_id, title, status, submission_idempotency_key) VALUES ($1, $2, $3, $4, 'Test post', 'pending_review', 'content-test-key')`,
        [postId, userId, workspaceId, assetId],
      );
      await pool.query(
        `UPDATE community_posts SET status = 'published', published_at = now() WHERE id = $1`,
        [postId],
      );

      const service = createPostgresCommunityContentService(pool);
      await assert.rejects(
        () =>
          service.create(
            {
              assetId,
              title: "Cross-account submission",
              idempotencyKey: "cross-account",
            },
            { userId: reporterId, workspaceId: reporterWorkspaceId },
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "COMMUNITY_ASSET_NOT_ALLOWED",
      );
      const publicPage = await service.listPublic({ query: "Test", tag: "" });
      assert.equal(publicPage.items.length, 1);
      assert.equal(publicPage.items[0]?.publicNickname, "Canvas Author");
      const publicPost = await service.getPublic(postId);
      assert.equal(publicPost.post.title, "Test post");
      const mine = await service.listMine({ userId, workspaceId });
      assert.equal(mine.items.length, 1);
      assert.equal(mine.items[0]?.title, "Test post");
      const report = await service.report(
        postId,
        { reason: "spam", detail: "Duplicate content" },
        { userId: reporterId, workspaceId },
      );
      assert.equal(report.report.status, "pending");
      await assert.rejects(
        () =>
          service.report(
            postId,
            { reason: "spam" },
            { userId: reporterId, workspaceId },
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "COMMUNITY_REPORT_RATE_LIMITED",
      );
      await pool.query(
        `UPDATE user_public_profiles SET profile_status = 'hidden' WHERE user_id = $1`,
        [userId],
      );
      assert.equal((await service.listPublic({})).items.length, 0);
      await assert.rejects(
        () => service.getPublic(postId),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "COMMUNITY_POST_NOT_FOUND",
      );
      await pool.query(
        `UPDATE user_public_profiles SET profile_status = 'active' WHERE user_id = $1`,
        [userId],
      );
      // 编辑：已发布 → 重新进入待审核，重新审核期间不公开
      const edited = await service.update(
        postId,
        { title: "Edited title", tags: ["edited", "tag2"] },
        { userId, workspaceId },
      );
      assert.equal(edited.post.title, "Edited title");
      assert.equal(edited.post.tags.join(","), "edited,tag2");
      assert.equal(edited.post.status, "pending_review");
      assert.equal(edited.post.publishedAt, null);
      assert.equal((await service.listPublic({})).items.length, 0);
      // 待审核编辑：保持待审核
      const editedAgain = await service.update(
        postId,
        { title: "Edited again" },
        { userId, workspaceId },
      );
      assert.equal(editedAgain.post.status, "pending_review");
      // 已拒绝编辑：重新排队并清空拒绝原因
      await pool.query(
        `UPDATE community_posts SET status = 'rejected', moderation_reason = 'off-topic' WHERE id = $1`,
        [postId],
      );
      const editedRejected = await service.update(
        postId,
        { title: "After rejection" },
        { userId, workspaceId },
      );
      assert.equal(editedRejected.post.status, "pending_review");
      assert.equal(editedRejected.post.moderationReason, null);
      // 非作者不能编辑
      await assert.rejects(
        () =>
          service.update(
            postId,
            { title: "Hijack" },
            { userId: reporterId, workspaceId: reporterWorkspaceId },
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "COMMUNITY_POST_NOT_FOUND",
      );
      const withdrawn = await service.withdraw(postId, { userId, workspaceId });
      assert.equal(withdrawn.post.status, "withdrawn");
      assert.equal((await service.listPublic({})).items.length, 0);
      // 已撤回不能编辑
      await assert.rejects(
        () =>
          service.update(
            postId,
            { title: "Too late" },
            { userId, workspaceId },
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "COMMUNITY_POST_STATE_INVALID",
      );
    } finally {
      await pool?.end();
      await admin
        .query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  },
);
