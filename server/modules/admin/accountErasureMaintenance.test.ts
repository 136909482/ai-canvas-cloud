import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../db/postgres.ts";
import { createPostgresAccountErasureMaintenanceService } from "./accountErasureMaintenance.ts";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OBJECT_KEY = `workspaces/${WORKSPACE_ID}/workspace/uploads/33333333-3333-4333-8333-333333333333.png`;

test("account erasure retries object failures before removing personal metadata", async () => {
  let jobStatus: "pending" | "processing" | "completed" = "pending";
  let failedMarked = 0;
  let completed = 0;
  let metadataDeleteCount = 0;
  const job = {
    id: JOB_ID,
    user_id: "deleted-user",
    personal_workspace_ids: [WORKSPACE_ID],
  };

  const query = async (sql: string) => {
    if (/^(?:BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
      return { rows: [], rowCount: null };
    }
    if (sql.includes("locked_at < now() - interval '15 minutes'")) {
      return { rows: [], rowCount: 0 };
    }
    if (
      sql.includes("FROM public.account_erasure_jobs") &&
      sql.includes("WHERE status = 'pending'") &&
      !sql.includes("FOR UPDATE")
    ) {
      return { rows: jobStatus === "pending" ? [job] : [], rowCount: 1 };
    }
    if (sql.includes("FOR UPDATE SKIP LOCKED")) {
      return {
        rows: jobStatus === "pending" ? [job] : [],
        rowCount: jobStatus === "pending" ? 1 : 0,
      };
    }
    if (
      sql.includes("SET status = 'processing'") &&
      sql.includes("attempt_count = attempt_count + 1")
    ) {
      jobStatus = "processing";
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT object_key FROM public.assets")) {
      return { rows: [{ object_key: OBJECT_KEY }], rowCount: 1 };
    }
    if (
      sql.includes("SET status = 'pending'") &&
      sql.includes("last_error_code = 'object_cleanup_failed'")
    ) {
      failedMarked += 1;
      jobStatus = "pending";
      return { rows: [], rowCount: 1 };
    }
    if (
      sql.includes("SELECT id::text FROM public.account_erasure_jobs") &&
      sql.includes("status = 'processing'")
    ) {
      return {
        rows: jobStatus === "processing" ? [{ id: JOB_ID }] : [],
        rowCount: jobStatus === "processing" ? 1 : 0,
      };
    }
    if (sql.includes("DELETE FROM public.")) {
      metadataDeleteCount += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE public."user"')) {
      return { rows: [], rowCount: 1 };
    }
    if (
      sql.includes("SET status = 'completed'") &&
      sql.includes("completed_at = now()")
    ) {
      completed += 1;
      jobStatus = "completed";
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
  };
  const database = {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as DbPool;
  let failDelete = true;
  const storage = {
    async objectExists(objectKey: string) {
      assert.equal(objectKey, OBJECT_KEY);
      return true;
    },
    async deleteObject(objectKey: string) {
      assert.equal(objectKey, OBJECT_KEY);
      if (failDelete)
        throw new Error("object storage is temporarily unavailable");
    },
  };
  const service = createPostgresAccountErasureMaintenanceService(
    database,
    storage,
  );

  const failed = await service.run({ apply: true, batchSize: 1 });
  assert.equal(failed.failedJobCount, 1);
  assert.equal(failed.completedJobCount, 0);
  assert.equal(failedMarked, 1);
  assert.equal(metadataDeleteCount, 0);
  assert.equal(jobStatus, "pending");

  failDelete = false;
  const retried = await service.run({ apply: true, batchSize: 1 });
  assert.equal(retried.failedJobCount, 0);
  assert.equal(retried.completedJobCount, 1);
  assert.equal(retried.eligibleObjectCount, 1);
  assert.equal(completed, 1);
  assert(metadataDeleteCount > 0);
  assert.equal(jobStatus, "completed");
});
