import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { isolateCurrentSchemaSql } from "../../dist/db/schemaBaseline.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresCommunityProfileService } from "../../dist/modules/community/profileService.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;

test(
  "PostgreSQL community profiles isolate accounts, gate posting on nickname, and enforce active status",
  { skip: databaseUrl ? false : "DATABASE_URL is not configured" },
  async () => {
    const schemaName = `community_profile_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;

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
        .filter((fileName) => fileName.endsWith(".sql"))
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

      await pool.query(`
        INSERT INTO "user" (id, name, email, email_verified, username, display_username)
        VALUES
          ('community-user-a', 'A', 'community-a@example.com', true, 'community_a', 'community_a'),
          ('community-user-b', 'B', 'community-b@example.com', true, 'community_b', 'community_b')
      `);

      const service = createPostgresCommunityProfileService(pool);
      assert.deepEqual(await service.get("community-user-a"), {
        profile: {
          publicNickname: null,
          profileStatus: "active",
          communityConsentVersion: null,
          communityConsentAt: null,
          canPost: false,
          updatedAt: null,
        },
      });

      // 只设置昵称即可获得投稿资格：投稿动作本身即展示授权，consent 不再是门槛。
      const updated = await service.update(
        { publicNickname: "Canvas Artist" },
        "community-user-a",
      );
      assert.equal(updated.profile.publicNickname, "Canvas Artist");
      assert.equal(updated.profile.communityConsentVersion, null);
      assert.equal(updated.profile.canPost, true);
      assert.equal(
        (await service.get("community-user-b")).profile.canPost,
        false,
      );

      await assert.rejects(
        () =>
          service.update(
            { publicNickname: "canvas artist" },
            "community-user-b",
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.apiCode === "PUBLIC_NICKNAME_UNAVAILABLE",
      );

      // consent 字段保留用于兼容与记录：清空后不回收投稿资格。
      const revoked = await service.update(
        { communityConsent: false },
        "community-user-a",
      );
      assert.equal(revoked.profile.communityConsentVersion, null);
      assert.equal(revoked.profile.communityConsentAt, null);
      assert.equal(revoked.profile.canPost, true);

      // 清除昵称后失去投稿资格。
      const cleared = await service.update(
        { publicNickname: null },
        "community-user-a",
      );
      assert.equal(cleared.profile.publicNickname, null);
      assert.equal(cleared.profile.canPost, false);

      await pool.query(
        `UPDATE "user" SET status = 'disabled' WHERE id = 'community-user-a'`,
      );
      await assert.rejects(
        () => service.get("community-user-a"),
        (error: unknown) =>
          error instanceof AuthServiceError && error.statusCode === 403,
      );
      await assert.rejects(
        () => service.update({ communityConsent: true }, "community-user-a"),
        (error: unknown) =>
          error instanceof AuthServiceError && error.statusCode === 403,
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
