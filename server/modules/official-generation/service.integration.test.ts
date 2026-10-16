import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { isolateCurrentSchemaSql } from "../../dist/db/schemaBaseline.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { createPostgresOfficialGenerationService } from "../../dist/modules/official-generation/service.js";
import {
  createOfficialGenerationKeyring,
  openSecret,
} from "../../dist/modules/official-generation/crypto.js";
import type { OfficialImageRequestSnapshot } from "./imageRequest.js";

loadDotEnv();
const databaseUrl = process.env.DATABASE_URL;

test(
  "official template upgrades preserve models, freeze settings and isolate accounts across service instances",
  { skip: databaseUrl ? false : "DATABASE_URL is not configured" },
  async () => {
    const schema = `official_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;
    const keyring = createOfficialGenerationKeyring({
      developmentSecret: "test-only-secret",
    });
    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 3,
        options: `-c search_path=${schema},public`,
      });
      for (const file of (
        await readdir(join(process.cwd(), "server/db/migrations"))
      )
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        await pool.query(
          isolateCurrentSchemaSql(
            await readFile(
              join(process.cwd(), "server/db/migrations", file),
              "utf8",
            ),
            schema,
          ),
        );
      }
      const actors = [
        { userId: "official_a", workspaceId: randomUUID() },
        { userId: "official_b", workspaceId: randomUUID() },
      ];
      const projects = [randomUUID(), randomUUID()];
      for (const [index, actor] of actors.entries()) {
        await pool.query(
          `INSERT INTO "user" (id,name,email,email_verified,user_no,username,display_username) VALUES ($1,$1,$2,true,$3,$1,$1)`,
          [actor.userId, `${actor.userId}@example.com`, 23001 + index],
        );
        await pool.query(
          `INSERT INTO workspaces (id,name,owner_user_id) VALUES ($1,'Test workspace',$2)`,
          [actor.workspaceId, actor.userId],
        );
        await pool.query(
          `INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
          [actor.workspaceId, actor.userId],
        );
        await pool.query(
          `INSERT INTO projects (id,workspace_id,name) VALUES ($1,$2,'Test project')`,
          [projects[index], actor.workspaceId],
        );
        await pool.query(
          `INSERT INTO user_feature_preferences (user_id,official_generation_enabled) VALUES ($1,true)`,
          [actor.userId],
        );
        await pool.query(
          `INSERT INTO credit_accounts (user_id,available_balance) VALUES ($1,100)`,
          [actor.userId],
        );
      }
      await pool.query(
        `INSERT INTO site_config_publications (singleton_id,revision_id,etag,config_json) VALUES (1,$1,$2,$3) ON CONFLICT (singleton_id) DO UPDATE SET config_json=EXCLUDED.config_json`,
        [
          randomUUID(),
          `"${"0".repeat(64)}"`,
          { features: { officialGenerationEnabled: true } },
        ],
      );
      const providerId = randomUUID();
      const modelId = randomUUID();
      await pool.query(
        `INSERT INTO official_provider_revisions (id,display_name,protocol,base_url,credential_envelope) VALUES ($1,'Test','openai-compatible','https://provider.example/v1','{}')`,
        [providerId],
      );
      await pool.query(
        `INSERT INTO official_models (id,provider_revision_id,public_name,upstream_model_id,price_1k,price_2k,price_4k,supports_edit,supports_references) VALUES ($1,$2,'公开名称','gpt-image-2',1,2,4,true,true)`,
        [modelId, providerId],
      );
      const options = { keyring, redemptionCodePepper: "test-only-pepper" };
      const deviceOne = createPostgresOfficialGenerationService(pool, options);
      const deviceTwo = createPostgresOfficialGenerationService(pool, options);
      const catalog = await deviceOne.listModels(actors[0]);
      assert.equal(catalog.models[0].parameterTemplate, "gpt-image");
      assert.doesNotMatch(
        JSON.stringify(catalog),
        /upstream_model_id|gpt-image-2|provider\.example/,
      );
      const input = {
        projectId: projects[0],
        modelId,
        clientTaskId: randomUUID(),
        idempotencyKey: randomUUID(),
        resolution: "2K" as const,
        ratio: "16:9",
        operationType: "generate" as const,
        prompt: "透明背景的小猫",
        quality: "high" as const,
        background: "transparent" as const,
      };
      const created = await deviceOne.createTask(input, actors[0]);
      assert.equal(created.balance.available, 98);
      const encrypted = (
        await pool.query(
          `SELECT request_envelope FROM official_generation_tasks WHERE id=$1`,
          [created.task.id],
        )
      ).rows[0].request_envelope;
      const snapshot = openSecret<OfficialImageRequestSnapshot>(
        encrypted,
        keyring,
      );
      assert.equal(snapshot.parameterTemplate, "gpt-image");
      assert.equal(snapshot.quality, "high");
      assert.equal(snapshot.background, "transparent");
      await pool.query(
        `UPDATE official_models SET parameter_template='nano-banana' WHERE id=$1`,
        [modelId],
      );
      assert.equal(
        (await deviceTwo.listModels(actors[0])).models[0].parameterTemplate,
        "nano-banana",
      );
      assert.equal(
        openSecret<OfficialImageRequestSnapshot>(encrypted, keyring)
          .parameterTemplate,
        "gpt-image",
      );
      const duplicate = await deviceTwo.createTask(input, actors[0]);
      assert.equal(duplicate.task.id, created.task.id);
      assert.equal(duplicate.balance.available, 98);
      assert.equal(
        (await deviceTwo.getTask(created.task.id, actors[0])).task.id,
        created.task.id,
      );
      assert.equal((await deviceTwo.listTasks(actors[1])).items.length, 0);
      await assert.rejects(
        () => deviceTwo.getTask(created.task.id, actors[1]),
        (error: unknown) =>
          (error as { statusCode: number }).statusCode === 404,
      );
      await assert.rejects(
        () =>
          deviceTwo.createTask(
            {
              ...input,
              clientTaskId: randomUUID(),
              idempotencyKey: randomUUID(),
            },
            actors[1],
          ),
        (error: unknown) =>
          (error as { statusCode: number }).statusCode === 404,
      );
      assert.equal((await deviceTwo.getBalance(actors[1])).available, 100);
      const own = await deviceTwo.createTask(
        {
          ...input,
          projectId: projects[1],
          clientTaskId: randomUUID(),
          idempotencyKey: randomUUID(),
        },
        actors[1],
      );
      assert.notEqual(own.task.id, created.task.id);
      assert.equal((await deviceOne.listTasks(actors[0])).items.length, 1);
      assert.equal(
        (await deviceTwo.cancelTask(created.task.id, actors[0])).balance
          .available,
        100,
      );
    } finally {
      await pool?.end();
      await admin
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .catch(() => undefined);
      await admin
        .query(`DROP SCHEMA IF EXISTS "${schema}_admin" CASCADE`)
        .catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  },
);
