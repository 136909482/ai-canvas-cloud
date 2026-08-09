import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import pg from "pg";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { createS3ObjectStorage } from "../../dist/modules/assets/s3ObjectStorage.js";
import {
  createPostgresAccountErasureMaintenanceService,
  createPostgresAdminAccountDeletionService,
} from "../../dist/modules/admin/index.js";

loadDotEnv();

const config = {
  databaseUrl: process.env.MIGRATION_DATABASE_URL,
  ordinaryAuthSecret: process.env.BETTER_AUTH_SECRET,
  endpoint: process.env.S3_ENDPOINT,
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
};
const enabled =
  process.env.ACCOUNT_ERASURE_INTEGRATION === "1" &&
  Object.values(config).every((value) => Boolean(value));

function databaseUrlForName(connectionString: string, databaseName: string) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteDatabaseName(databaseName: string) {
  assert.match(databaseName, /^[a-z][a-z0-9_]+$/);
  return `"${databaseName}"`;
}

function emailChallengeHash(secret: string, purpose: string, email: string) {
  return createHmac("sha256", secret)
    .update(purpose)
    .update("\0")
    .update(email)
    .digest("hex");
}

async function applyMigrations(pool: pg.Pool) {
  const files = (
    await readdir(join(process.cwd(), "server", "db", "migrations"))
  )
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  for (const fileName of files) {
    await pool.query(
      await readFile(
        join(process.cwd(), "server", "db", "migrations", fileName),
        "utf8",
      ),
    );
  }
}

test(
  "account deletion revokes every device, preserves team data, and retries the deferred object purge",
  {
    skip: enabled
      ? false
      : "set ACCOUNT_ERASURE_INTEGRATION=1 with migration PostgreSQL and S3 settings",
    timeout: 60_000,
  },
  async () => {
    const runId = randomUUID();
    const databaseName = `account_erasure_${runId.replaceAll("-", "").slice(0, 16)}`;
    const control = new pg.Client({
      connectionString: databaseUrlForName(config.databaseUrl!, "postgres"),
    });
    const databaseUrl = databaseUrlForName(config.databaseUrl!, databaseName);
    const targetId = `delete_target_${runId}`;
    const successorId = `delete_successor_${runId}`;
    const adminId = `delete_admin_${runId}`;
    const suffix = runId.replaceAll("-", "").slice(0, 16);
    const targetEmail = `delete-target-${suffix}@example.invalid`;
    const personalWorkspaceId = randomUUID();
    const teamWorkspaceId = randomUUID();
    const personalProjectId = randomUUID();
    const teamProjectId = randomUUID();
    const assetId = randomUUID();
    const objectKey = `workspaces/${personalWorkspaceId}/projects/${personalProjectId}/uploads/${assetId}.png`;
    const objectBody = Buffer.from(`account-erasure-${runId}`);
    const s3Client = new S3Client({
      endpoint: config.endpoint!,
      region: config.region!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId!,
        secretAccessKey: config.secretAccessKey!,
      },
    });
    let pool: pg.Pool | undefined;

    try {
      await control.connect();
      await control.query(`CREATE DATABASE ${quoteDatabaseName(databaseName)}`);
      pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
      await applyMigrations(pool);

      await pool.query(
        `
          INSERT INTO admin."user" (
            id, name, email, role, username, display_username
          ) VALUES ($1, 'Deletion Admin', $2, 'super_admin', $3, $3)
        `,
        [
          adminId,
          `deletion-admin-${suffix}@example.invalid`,
          `admin_${suffix}`,
        ],
      );
      await pool.query(
        `
          INSERT INTO public."user" (
            id, name, email, username, display_username
          ) VALUES
            ($1, $2, $3, $4, $4),
            ($5, $6, $7, $8, $8)
        `,
        [
          targetId,
          `Target_${suffix}`,
          targetEmail,
          `target_${suffix}`,
          successorId,
          `Successor_${suffix}`,
          `delete-successor-${suffix}@example.invalid`,
          `successor_${suffix}`,
        ],
      );
      await pool.query(
        `
          INSERT INTO public.workspaces (id, type, name, owner_user_id)
          VALUES
            ($1, 'personal', 'Deletion personal workspace', $2),
            ($3, 'team', 'Deletion team workspace', $2)
        `,
        [personalWorkspaceId, targetId, teamWorkspaceId],
      );
      await pool.query(
        `
          INSERT INTO public.workspace_members (workspace_id, user_id, role)
          VALUES
            ($1, $2, 'owner'),
            ($3, $2, 'owner'),
            ($3, $4, 'editor')
        `,
        [personalWorkspaceId, targetId, teamWorkspaceId, successorId],
      );
      await pool.query(
        `
          INSERT INTO public.projects (id, workspace_id, name)
          VALUES
            ($1, $2, 'Personal deletion project'),
            ($3, $4, 'Team project stays')
        `,
        [
          personalProjectId,
          personalWorkspaceId,
          teamProjectId,
          teamWorkspaceId,
        ],
      );
      await pool.query(
        `
          INSERT INTO public.assets (
            id, workspace_id, origin_project_id, created_by_user_id, object_key,
            original_file_name, mime_type, byte_size, asset_kind, status
          ) VALUES ($1, $2, $3, $4, $5, 'erase.png', 'image/png', $6, 'upload', 'completed')
        `,
        [
          assetId,
          personalWorkspaceId,
          personalProjectId,
          targetId,
          objectKey,
          objectBody.byteLength,
        ],
      );
      await pool.query(
        `
          INSERT INTO public.project_snapshots (
            project_id, project_version, last_sequence, snapshot_type, schema_version,
            record_json, byte_size, asset_manifest_json, is_valid
          ) VALUES ($1, 0, 0, 'manual', 1, '{}'::jsonb, 2, '[]'::jsonb, true)
        `,
        [personalProjectId],
      );
      await pool.query(
        `
          INSERT INTO public."session" (id, expires_at, token, user_id)
          VALUES
            ($1, now() + interval '1 day', $2, $3),
            ($4, now() + interval '1 day', $5, $3)
        `,
        [
          `delete-session-a-${suffix}`,
          `delete-token-a-${suffix}`,
          targetId,
          `delete-session-b-${suffix}`,
          `delete-token-b-${suffix}`,
        ],
      );
      await pool.query(
        `
          INSERT INTO public.auth_devices (user_id, device_key, last_session_id)
          VALUES ($1, $2, $3), ($1, $4, $5)
        `,
        [
          targetId,
          `device-a-${suffix}`,
          `delete-session-a-${suffix}`,
          `device-b-${suffix}`,
          `delete-session-b-${suffix}`,
        ],
      );
      await pool.query(
        `
          INSERT INTO public."account" (id, account_id, provider_id, user_id, password)
          VALUES ($1, $2, 'credential', $3, 'password-hash')
        `,
        [`delete-account-${suffix}`, targetEmail, targetId],
      );
      await pool.query(
        `
          INSERT INTO public.user_public_profiles (
            user_id, public_nickname, community_consent_version, community_consent_at
          ) VALUES ($1, $2, 1, now())
        `,
        [targetId, `Public_${suffix}`],
      );
      await pool.query(
        `
          INSERT INTO public.registration_email_challenges (email_hash, code_hash, expires_at)
          VALUES ($1, repeat('a', 64), now() + interval '10 minutes')
        `,
        [
          emailChallengeHash(
            config.ordinaryAuthSecret!,
            "registration-email",
            targetEmail,
          ),
        ],
      );
      await pool.query(
        `
          INSERT INTO public.password_reset_email_challenges (
            email_hash, code_hash, reset_token_ciphertext, expires_at
          ) VALUES ($1, repeat('b', 64), repeat('c', 40), now() + interval '10 minutes')
        `,
        [
          emailChallengeHash(
            config.ordinaryAuthSecret!,
            "password-reset-email",
            targetEmail,
          ),
        ],
      );
      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.bucket!,
          Key: objectKey,
          Body: objectBody,
          ContentType: "image/png",
        }),
      );

      const deletion = createPostgresAdminAccountDeletionService(pool, {
        auditSecret: "account-erasure-integration-audit-secret",
        ordinaryAuthSecret: config.ordinaryAuthSecret!,
        adminService: {
          async requirePermission(_context, permission) {
            assert.equal(permission, "user.delete");
            return {
              admin: {
                id: adminId,
                username: `admin_${suffix}`,
                role: "super_admin",
                status: "active",
              },
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            };
          },
        },
      });
      const preview = await deletion.getDeletionPreview(targetId, {
        requestId: `preview-${suffix}`,
      });
      assert.equal(preview.personalWorkspaceCount, 1);
      assert.equal(preview.ownedTeams[0]?.successors[0]?.id, successorId);

      const deleted = await deletion.deleteUser(
        targetId,
        {
          reason: "Account erasure integration verification",
          confirmUserNumber: preview.userNumber,
          ownershipTransfers: [
            { workspaceId: teamWorkspaceId, successorUserId: successorId },
          ],
        },
        { requestId: `delete-${suffix}` },
      );
      assert.equal(deleted.personalWorkspaceCount, 1);
      assert.equal(deleted.removedTeamMembershipCount, 1);
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public."session" WHERE user_id = $1`,
            [targetId],
          )
        ).rows[0]?.count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public.auth_devices WHERE user_id = $1`,
            [targetId],
          )
        ).rows[0]?.count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public."account" WHERE user_id = $1`,
            [targetId],
          )
        ).rows[0]?.count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public.user_public_profiles WHERE user_id = $1`,
            [targetId],
          )
        ).rows[0]?.count,
        0,
      );
      const tombstone = (
        await pool.query(
          `SELECT status, email, username FROM public."user" WHERE id = $1`,
          [targetId],
        )
      ).rows[0];
      assert.equal(tombstone?.status, "deleted");
      assert.notEqual(tombstone?.email, targetEmail);
      assert.notEqual(tombstone?.username, `target_${suffix}`);
      assert.equal(
        (
          await pool.query(
            `SELECT owner_user_id FROM public.workspaces WHERE id = $1`,
            [teamWorkspaceId],
          )
        ).rows[0]?.owner_user_id,
        successorId,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
            [teamWorkspaceId, targetId],
          )
        ).rows[0]?.count,
        0,
      );
      assert.notEqual(
        (
          await pool.query(
            `SELECT deleted_at FROM public.projects WHERE id = $1`,
            [personalProjectId],
          )
        ).rows[0]?.deleted_at,
        null,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT deleted_at FROM public.projects WHERE id = $1`,
            [teamProjectId],
          )
        ).rows[0]?.deleted_at,
        null,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public.registration_email_challenges`,
          )
        ).rows[0]?.count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public.password_reset_email_challenges`,
          )
        ).rows[0]?.count,
        0,
      );
      const audit = (
        await pool.query(
          `SELECT after_json FROM admin.audit_events WHERE request_id = $1`,
          [`delete-${suffix}`],
        )
      ).rows[0]?.after_json;
      assert.equal(audit.reason, "Account erasure integration verification");
      assert.match(JSON.stringify(audit), new RegExp(teamWorkspaceId));
      assert.doesNotMatch(JSON.stringify(audit), new RegExp(targetEmail));

      await pool.query(
        `UPDATE public.account_erasure_jobs SET purge_after = now() WHERE user_id = $1`,
        [targetId],
      );
      const objectStorage = createS3ObjectStorage({
        endpoint: config.endpoint!,
        bucket: config.bucket!,
        region: config.region!,
        accessKeyId: config.accessKeyId!,
        secretAccessKey: config.secretAccessKey!,
        forcePathStyle: true,
      });
      let failDelete = true;
      const maintenance = createPostgresAccountErasureMaintenanceService(pool, {
        objectExists: objectStorage.objectExists,
        async deleteObject(key) {
          if (failDelete) throw new Error("simulated object deletion failure");
          await objectStorage.deleteObject(key);
        },
      });
      const failed = await maintenance.run({ apply: true, batchSize: 1 });
      assert.equal(failed.failedJobCount, 1);
      assert.equal(
        (
          await pool.query(
            `SELECT status FROM public.account_erasure_jobs WHERE user_id = $1`,
            [targetId],
          )
        ).rows[0]?.status,
        "pending",
      );
      failDelete = false;
      const completed = await maintenance.run({ apply: true, batchSize: 1 });
      assert.equal(completed.completedJobCount, 1);
      assert.equal(await objectStorage.objectExists(objectKey), false);
      assert.equal(
        (
          await pool.query(
            `SELECT status, completed_at IS NOT NULL AS finished FROM public.account_erasure_jobs WHERE user_id = $1`,
            [targetId],
          )
        ).rows[0]?.status,
        "completed",
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public.projects WHERE id = $1`,
            [personalProjectId],
          )
        ).rows[0]?.count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public.workspaces WHERE id = $1`,
            [personalWorkspaceId],
          )
        ).rows[0]?.count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM public.projects WHERE id = $1`,
            [teamProjectId],
          )
        ).rows[0]?.count,
        1,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT personal_data_purged_at IS NOT NULL AS purged FROM public."user" WHERE id = $1`,
            [targetId],
          )
        ).rows[0]?.purged,
        true,
      );
    } finally {
      await s3Client
        .send(
          new DeleteObjectCommand({ Bucket: config.bucket!, Key: objectKey }),
        )
        .catch(() => undefined);
      s3Client.destroy();
      await pool?.end();
      if (control.readyForQuery) {
        await control
          .query(
            `DROP DATABASE IF EXISTS ${quoteDatabaseName(databaseName)} WITH (FORCE)`,
          )
          .catch(() => undefined);
      }
      await control.end();
    }
  },
);
