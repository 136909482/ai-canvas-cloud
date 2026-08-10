import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { requiredEnv } from "./recovery-common.mjs";

const ids = {
  users: [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
  ],
  workspaces: [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
  ],
  projects: [
    "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000002",
  ],
  asset: "40000000-0000-4000-8000-000000000001",
};

export async function seedLocalRecoveryDrill(env = process.env) {
  const body = Buffer.from("ai-canvas-cloud local recovery drill\n");
  const objectKey = `local-recovery-drill/${ids.asset}/source.txt`;
  const s3 = new S3Client({
    endpoint: requiredEnv(env, "S3_ENDPOINT"),
    region: requiredEnv(env, "S3_REGION"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env, "S3_SECRET_ACCESS_KEY"),
    },
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: requiredEnv(env, "S3_BUCKET"),
      Key: objectKey,
      Body: body,
      ContentType: "text/plain",
    }),
  );

  const client = new pg.Client({
    connectionString: requiredEnv(env, "DATABASE_URL"),
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO public."user" (id, name, email, username, display_username)
       VALUES ($1, 'Local Recovery One', 'local-recovery-1@example.invalid', 'local_recovery_1', 'local_recovery_1'),
              ($2, 'Local Recovery Two', 'local-recovery-2@example.invalid', 'local_recovery_2', 'local_recovery_2')`,
      ids.users,
    );
    await client.query(
      `INSERT INTO public.workspaces (id, type, name, owner_user_id)
       VALUES ($1, 'personal', 'Local recovery workspace one', $2),
              ($3, 'personal', 'Local recovery workspace two', $4)`,
      [ids.workspaces[0], ids.users[0], ids.workspaces[1], ids.users[1]],
    );
    await client.query(
      `INSERT INTO public.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`,
      [ids.workspaces[0], ids.users[0], ids.workspaces[1], ids.users[1]],
    );
    await client.query(
      `INSERT INTO public.projects (id, workspace_id, name)
       VALUES ($1, $2, 'Local recovery project one'),
              ($3, $4, 'Local recovery project two')`,
      [ids.projects[0], ids.workspaces[0], ids.projects[1], ids.workspaces[1]],
    );
    await client.query(
      `INSERT INTO public.assets (
         id, workspace_id, origin_project_id, created_by_user_id, object_key,
         original_file_name, mime_type, byte_size, sha256, asset_kind, status
       ) VALUES ($1, $2, $3, $4, $5, 'source.txt', 'text/plain', $6, $7, 'upload', 'completed')`,
      [
        ids.asset,
        ids.workspaces[0],
        ids.projects[0],
        ids.users[0],
        objectKey,
        body.byteLength,
        createHash("sha256").update(body).digest("hex"),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  console.log(
    JSON.stringify({ event: "local_recovery_drill_seeded", workspaces: 2 }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  seedLocalRecoveryDrill().catch((error) => {
    console.error(
      JSON.stringify({
        event: "local_recovery_drill_seed_failed",
        error: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown error",
        code:
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined,
      }),
    );
    process.exitCode = 1;
  });
}
