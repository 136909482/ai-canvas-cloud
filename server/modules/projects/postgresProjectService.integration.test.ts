import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { isolateCurrentSchemaSql } from "../../dist/db/schemaBaseline.js";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresProjectService } from "../../dist/modules/projects/postgresProjectService.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;

test(
  "PostgreSQL project service isolates two workspaces through real constraints and queries",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `project_test_${randomUUID().replaceAll("-", "")}`;
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

    try {
      await pool.query(`CREATE SCHEMA "${schemaName}"`);
      await pool.query(`SET search_path TO "${schemaName}", public`);

      await pool.query(
        isolateCurrentSchemaSql(
          await readFile(
            join(
              process.cwd(),
              "server",
              "db",
              "migrations",
              "0001_current_schema.sql",
            ),
            "utf8",
          ),
          schemaName,
        ),
      );

      await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified, username, display_username)
      VALUES
        ('user-a', 'A', 'a-project-test@example.com', true, 'project_a', 'project_a'),
        ('user-b', 'B', 'b-project-test@example.com', true, 'project_b', 'project_b')
    `);
      await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A workspace', 'user-a'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B workspace', 'user-b')
    `);
      await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user-a', 'owner'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'user-b', 'owner')
    `);

      const service = createPostgresProjectService(pool);
      const actorA = {
        userId: "user-a",
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      };
      const actorB = {
        userId: "user-b",
        workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      };
      const clientProjectId = "11111111-1111-4111-8111-111111111111";
      const createdA = await service.createProject(
        { id: clientProjectId, name: "A project" },
        actorA,
      );
      const retriedA = await service.createProject(
        { id: clientProjectId, name: "A project" },
        actorA,
      );
      const createdB = await service.createProject(
        { name: "B project" },
        actorB,
      );

      assert.equal(createdA.project.id, clientProjectId);
      assert.deepEqual(retriedA, createdA);

      assert.deepEqual(
        (await service.listProjects({}, actorA)).projects.map(
          (project) => project.id,
        ),
        [createdA.project.id],
      );
      assert.deepEqual(
        (await service.listProjects({}, actorB)).projects.map(
          (project) => project.id,
        ),
        [createdB.project.id],
      );
      await assert.rejects(
        () => service.getProject(createdB.project.id, actorA),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );

      const archived = await service.archiveProject(
        createdA.project.id,
        actorA,
      );
      assert(archived.project.archivedAt);
      assert.equal(
        (await service.listProjects({ status: "active" }, actorA)).projects
          .length,
        0,
      );
      assert.equal(
        (await service.listProjects({ status: "archived" }, actorA)).projects
          .length,
        1,
      );

      await service.restoreProject(createdA.project.id, actorA);
      await service.renameProject(
        createdA.project.id,
        { name: "A renamed" },
        actorA,
      );
      assert.equal(
        (await service.getProject(createdA.project.id, actorA)).project.name,
        "A renamed",
      );
      const sharedProject = await service.createProject(
        { name: "A shared project" },
        actorA,
      );
      const uniqueAssetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const sharedAssetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await pool.query(
        `
          INSERT INTO assets (
            id, workspace_id, origin_project_id, created_by_user_id, object_key,
            original_file_name, mime_type, byte_size, asset_kind, status
          ) VALUES
            ($1, $3, $4, 'user-a', $5, 'unique.png', 'image/png', 100, 'generated', 'completed'),
            ($2, $3, $4, 'user-a', $6, 'shared.png', 'image/png', 200, 'generated', 'completed')
        `,
        [
          uniqueAssetId,
          sharedAssetId,
          actorA.workspaceId,
          createdA.project.id,
          `workspaces/${actorA.workspaceId}/projects/${createdA.project.id}/generated/2026-07-15/${uniqueAssetId}.png`,
          `workspaces/${actorA.workspaceId}/projects/${createdA.project.id}/generated/2026-07-15/${sharedAssetId}.png`,
        ],
      );
      await pool.query(
        `
          INSERT INTO project_nodes (
            project_id, node_id, node_type, position_x, position_y
          ) VALUES
            ($1, 'unique-asset-node', 'image', 0, 0),
            ($2, 'shared-asset-node', 'image', 0, 0)
        `,
        [createdA.project.id, sharedProject.project.id],
      );
      await pool.query(
        `
          INSERT INTO asset_references (
            workspace_id, asset_id, project_id, node_id, reference_role
          ) VALUES
            ($1, $2, $3, 'unique-asset-node', 'result'),
            ($1, $4, $5, 'shared-asset-node', 'result')
        `,
        [
          actorA.workspaceId,
          uniqueAssetId,
          createdA.project.id,
          sharedAssetId,
          sharedProject.project.id,
        ],
      );
      await pool.query(
        `
          INSERT INTO project_snapshots (
            project_id, project_version, last_sequence, snapshot_type,
            schema_version, record_json, byte_size, asset_manifest_json, is_valid
          ) VALUES ($1, 0, 0, 'manual', 1, '{}'::jsonb, 2, $2::jsonb, true)
        `,
        [createdA.project.id, JSON.stringify([uniqueAssetId])],
      );

      const deleteResponse = await service.deleteProject(
        createdA.project.id,
        actorA,
      );
      assert.deepEqual(deleteResponse, { ok: true, releasedBytes: 100 });
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS count FROM asset_references WHERE project_id = $1`,
            [createdA.project.id],
          )
        ).rows[0]?.count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::integer AS count FROM asset_references WHERE project_id = $1 AND asset_id = $2`,
            [sharedProject.project.id, sharedAssetId],
          )
        ).rows[0]?.count,
        1,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT is_valid FROM project_snapshots WHERE project_id = $1`,
            [createdA.project.id],
          )
        ).rows[0]?.is_valid,
        false,
      );
      await assert.rejects(
        () => service.getProject(createdA.project.id, actorA),
        AuthServiceError,
      );
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await pool.end();
    }
  },
);
