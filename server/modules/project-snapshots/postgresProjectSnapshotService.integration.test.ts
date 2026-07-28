import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresProjectGraphService } from "../../dist/modules/project-graph/postgresProjectGraphService.js";
import { createPostgresProjectSnapshotService } from "../../dist/modules/project-snapshots/postgresProjectSnapshotService.js";
import { createPostgresProjectService } from "../../dist/modules/projects/postgresProjectService.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;

test(
  "PostgreSQL checkpoints save the current graph and remain tenant scoped",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `snapshot_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;

    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 4,
        options: `-c search_path=${schemaName},public`,
      });

      const migrationFiles = (
        await readdir(join(process.cwd(), "server", "db", "migrations"))
      )
        .filter(
          (fileName) =>
            fileName.endsWith(".sql") &&
            !/^(?:002[5-9]|0030|003[235])_/.test(fileName),
        )
        .sort();
      for (const fileName of migrationFiles) {
        await pool.query(
          await readFile(
            join(process.cwd(), "server", "db", "migrations", fileName),
            "utf8",
          ),
        );
      }

      await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES
        ('snapshot-user-a', 'A', 'a-snapshot-test@example.com', true),
        ('snapshot-user-b', 'B', 'b-snapshot-test@example.com', true)
    `);
      await pool.query(`
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A workspace', 'snapshot-user-a'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B workspace', 'snapshot-user-b')
    `);
      await pool.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'snapshot-user-a', 'owner'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'snapshot-user-b', 'owner')
    `);

      const projects = createPostgresProjectService(pool);
      const graphs = createPostgresProjectGraphService(pool);
      const snapshots = createPostgresProjectSnapshotService(pool);
      const actorA = {
        userId: "snapshot-user-a",
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      };
      const actorB = {
        userId: "snapshot-user-b",
        workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      };
      const projectA = (
        await projects.createProject({ name: "Checkpoint A" }, actorA)
      ).project;
      const projectB = (
        await projects.createProject({ name: "Checkpoint B" }, actorB)
      ).project;

      await graphs.applyOperations(
        projectA.id,
        {
          baseVersion: 0,
          clientId: "browser_a",
          batchId: "snapshot_batch_1",
          idempotencyKey: "snapshot_graph_1",
          operations: [
            {
              type: "upsertNode",
              node: {
                id: "node-a",
                nodeType: "text",
                position: { x: 10, y: 20 },
                dataSchemaVersion: 1,
                data: { text: "saved" },
              },
            },
          ],
        },
        actorA,
      );

      const [checkpoint, repeatedCheckpoint] = await Promise.all([
        snapshots.createCheckpoint(
          projectA.id,
          {
            expectedVersion: 1,
            expectedSequence: 1,
          },
          actorA,
        ),
        snapshots.createCheckpoint(
          projectA.id,
          {
            expectedVersion: 1,
            expectedSequence: 1,
          },
          actorA,
        ),
      ]);
      assert.equal(repeatedCheckpoint.checkpoint.id, checkpoint.checkpoint.id);
      assert.equal(
        (
          await pool.query(
            `SELECT 1 FROM project_snapshots WHERE project_id = $1 AND project_version = 1 AND snapshot_type = 'manual'`,
            [projectA.id],
          )
        ).rowCount,
        1,
      );
      assert.equal(checkpoint.checkpoint.snapshotType, "manual");
      assert.equal(checkpoint.checkpoint.projectVersion, 1);
      assert.equal(checkpoint.checkpoint.lastSequence, 1);
      assert.equal(checkpoint.checkpoint.isValid, true);
      assert.equal(checkpoint.project.version, 1);
      assert.equal(checkpoint.project.lastSequence, 1);

      const stored = await pool.query<{
        saved_snapshot_id: string;
        record_json: {
          project: { id: string; version: number; lastSequence: number };
          canvas: {
            nodes: Array<{ id: string; data: Record<string, unknown> }>;
            edges: unknown[];
          };
          taskQueue: { tasks: unknown[] };
        };
        byte_size: string;
      }>(
        `
        SELECT p.saved_snapshot_id::text, s.record_json, s.byte_size
        FROM projects p
        JOIN project_snapshots s ON s.id = p.saved_snapshot_id
        WHERE p.id = $1
      `,
        [projectA.id],
      );
      assert.equal(stored.rows[0]?.saved_snapshot_id, checkpoint.checkpoint.id);
      assert.equal(stored.rows[0]?.record_json.project.id, projectA.id);
      assert.equal(stored.rows[0]?.record_json.project.version, 1);
      assert.equal(stored.rows[0]?.record_json.canvas.nodes[0]?.id, "node-a");
      assert.deepEqual(stored.rows[0]?.record_json.canvas.nodes[0]?.data, {
        text: "saved",
      });
      assert.deepEqual(stored.rows[0]?.record_json.taskQueue.tasks, []);
      assert(Number(stored.rows[0]?.byte_size ?? 0) > 0);

      await graphs.applyOperations(
        projectA.id,
        {
          baseVersion: 1,
          clientId: "browser_a",
          batchId: "snapshot_batch_2",
          idempotencyKey: "snapshot_graph_2",
          operations: [
            {
              type: "upsertNode",
              node: {
                id: "node-b",
                nodeType: "text",
                position: { x: 40, y: 80 },
                dataSchemaVersion: 1,
                data: { text: "second" },
              },
            },
          ],
        },
        actorA,
      );
      const periodicCheckpoint = await snapshots.createCheckpoint(
        projectA.id,
        {
          expectedVersion: 2,
          expectedSequence: 2,
          checkpointType: "periodic",
        },
        actorA,
      );
      assert.equal(periodicCheckpoint.checkpoint.snapshotType, "periodic");
      assert.equal(periodicCheckpoint.project.version, 2);

      const savedAfterPeriodic = await pool.query<{
        saved_snapshot_id: string;
      }>(`SELECT saved_snapshot_id::text FROM projects WHERE id = $1`, [
        projectA.id,
      ]);
      assert.equal(
        savedAfterPeriodic.rows[0]?.saved_snapshot_id,
        checkpoint.checkpoint.id,
      );

      const secondCheckpoint = await snapshots.createCheckpoint(
        projectA.id,
        {
          expectedVersion: 2,
          expectedSequence: 2,
        },
        actorA,
      );
      const firstPage = await snapshots.listRevisions(
        projectA.id,
        { limit: 1 },
        actorA,
      );
      assert.deepEqual(
        firstPage.revisions.map((revision) => revision.id),
        [secondCheckpoint.checkpoint.id],
      );
      assert(firstPage.nextCursor);
      assert.equal("recordJson" in firstPage.revisions[0]!, false);
      const secondPage = await snapshots.listRevisions(
        projectA.id,
        { cursor: firstPage.nextCursor, limit: 1 },
        actorA,
      );
      assert.deepEqual(
        secondPage.revisions.map((revision) => revision.id),
        [periodicCheckpoint.checkpoint.id],
      );
      assert(secondPage.nextCursor);
      const thirdPage = await snapshots.listRevisions(
        projectA.id,
        { cursor: secondPage.nextCursor, limit: 1 },
        actorA,
      );
      assert.deepEqual(
        thirdPage.revisions.map((revision) => revision.id),
        [checkpoint.checkpoint.id],
      );
      assert.equal(thirdPage.nextCursor, null);
      const revisionDetail = await snapshots.getRevision(
        projectA.id,
        2,
        actorA,
      );
      assert.equal(
        revisionDetail.checkpoint.id,
        secondCheckpoint.checkpoint.id,
      );
      assert.equal(revisionDetail.record.project.id, projectA.id);
      assert.equal(revisionDetail.record.project.version, 2);
      assert.deepEqual(
        revisionDetail.record.canvas.nodes.map((node) => node.id),
        ["node-a", "node-b"],
      );

      const restored = await snapshots.restoreRevision(
        projectA.id,
        1,
        {
          expectedVersion: 2,
          expectedSequence: 2,
        },
        actorA,
      );
      assert.equal(restored.restoredCheckpoint.id, checkpoint.checkpoint.id);
      assert.equal(restored.preRestoreCheckpoint.snapshotType, "pre_restore");
      assert.equal(restored.version, 3);
      assert.equal(restored.sequence, 3);
      assert.equal(restored.project.nodeCount, 1);
      assert.equal(restored.project.edgeCount, 0);

      const restoredGraph = await graphs.getGraph(projectA.id, actorA);
      assert.equal(restoredGraph.version, 3);
      assert.equal(restoredGraph.sequence, 3);
      assert.deepEqual(
        restoredGraph.nodes.map((node) => node.id),
        ["node-a"],
      );
      assert.deepEqual(restoredGraph.nodes[0]?.data, { text: "saved" });
      const restoreChanges = await graphs.getChanges(projectA.id, 2, actorA);
      assert.equal(restoreChanges.changes.length, 1);
      assert.equal(restoreChanges.changes[0]?.source, "restore");
      assert.equal(restoreChanges.changes[0]?.resultVersion, 3);
      assert(
        restoreChanges.changes[0]?.operations.some(
          (operation) =>
            operation.type === "deleteNode" && operation.nodeId === "node-b",
        ),
      );

      const preRestoreDetail = await snapshots.getRevision(
        projectA.id,
        2,
        actorA,
      );
      assert.equal(
        preRestoreDetail.checkpoint.id,
        restored.preRestoreCheckpoint.id,
      );
      assert.equal(preRestoreDetail.record.canvas.nodes.length, 2);

      await assert.rejects(
        () =>
          snapshots.createCheckpoint(
            projectA.id,
            { expectedVersion: 0, expectedSequence: 0 },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 409 &&
          error.apiCode === "PROJECT_VERSION_CONFLICT" &&
          error.details?.currentVersion === 3,
      );

      await assert.rejects(
        () =>
          snapshots.createCheckpoint(
            projectB.id,
            { expectedVersion: 0, expectedSequence: 0 },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
      await assert.rejects(
        () => snapshots.listRevisions(projectB.id, {}, actorA),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
      await assert.rejects(
        () => snapshots.getRevision(projectB.id, 0, actorA),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
      await assert.rejects(
        () => snapshots.getRevision(projectA.id, 99, actorA),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
      await assert.rejects(
        () =>
          snapshots.restoreRevision(
            projectB.id,
            0,
            { expectedVersion: 0, expectedSequence: 0 },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
      await assert.rejects(
        () =>
          snapshots.restoreRevision(
            projectA.id,
            99,
            { expectedVersion: 3, expectedSequence: 3 },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
      await assert.rejects(
        () =>
          snapshots.restoreRevision(
            projectA.id,
            1,
            { expectedVersion: 2, expectedSequence: 2 },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 409 &&
          error.apiCode === "PROJECT_VERSION_CONFLICT" &&
          error.details?.currentVersion === 3,
      );

      await projects.archiveProject(projectA.id, actorA);
      await assert.rejects(
        () =>
          snapshots.createCheckpoint(
            projectA.id,
            { expectedVersion: 3, expectedSequence: 3 },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 403 &&
          error.apiCode === "ACCESS_DENIED",
      );
      await assert.rejects(
        () =>
          snapshots.restoreRevision(
            projectA.id,
            1,
            { expectedVersion: 3, expectedSequence: 3 },
            actorA,
          ),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 403 &&
          error.apiCode === "ACCESS_DENIED",
      );
    } finally {
      await pool?.end();
      if (admin.readyForQuery) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
      await admin.end();
    }
  },
);
