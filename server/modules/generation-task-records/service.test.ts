import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../db/postgres.ts";
import { AuthServiceError } from "../auth/service.ts";
import type { WorkspaceAuthorizationService } from "../workspaces/authorization.ts";
import {
  createPostgresGenerationTaskRecordService,
  validateCreateGenerationTaskRecord,
} from "./service.ts";

const CLIENT_TASK_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "33333333-3333-4333-8333-333333333333";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    clientTaskId: CLIENT_TASK_ID,
    title: "  图像生成 #1a2b3c4d  ",
    category: "image",
    status: "succeeded",
    durationMs: 1200,
    resultCount: 1,
    modelEntryId: MODEL_ENTRY_ID,
    assetIds: [ASSET_ID],
    startedAt: "2026-08-15T10:00:00.000Z",
    completedAt: "2026-08-15T10:00:01.200Z",
    ...overrides,
  };
}

test("generation task record validation normalizes sanitized summary fields", () => {
  assert.deepEqual(validateCreateGenerationTaskRecord(validInput()), {
    clientTaskId: CLIENT_TASK_ID,
    title: "图像生成 #1a2b3c4d",
    category: "image",
    status: "succeeded",
    failureCategory: null,
    resultCount: 1,
    durationMs: 1200,
    modelEntryId: MODEL_ENTRY_ID,
    assetIds: [ASSET_ID],
    startedAt: "2026-08-15T10:00:00.000Z",
    completedAt: "2026-08-15T10:00:01.200Z",
  });
  assert.equal(
    validateCreateGenerationTaskRecord(
      validInput({
        status: "failed",
        failureCategory: "upstream",
        resultCount: 0,
      }),
    ).failureCategory,
    "upstream",
  );
  assert.equal(
    validateCreateGenerationTaskRecord(
      validInput({ status: "canceled", durationMs: 300, resultCount: 0 }),
    ).resultCount,
    0,
  );
});

test("generation task record validation rejects private and unbounded fields", () => {
  for (const input of [
    validInput({ prompt: "private prompt" }),
    validInput({ title: "x".repeat(121) }),
    validInput({ clientTaskId: "not-a-uuid" }),
    validInput({ status: "failed", durationMs: 10 }),
    validInput({ durationMs: 86_400_001 }),
    validInput({ resultCount: 33 }),
    validInput({ assetIds: ["not-a-uuid"] }),
    validInput({ startedAt: "2026-08-15T10:00:02.000Z" }),
  ]) {
    assert.throws(
      () => validateCreateGenerationTaskRecord(input),
      (error) =>
        error instanceof AuthServiceError &&
        error.apiCode === "VALIDATION_FAILED",
    );
  }
});

test("postgres task records upsert by actor task and list owned history", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const authorized: unknown[] = [];
  const pool = {
    async query(sql: string, values: unknown[]) {
      queries.push({ sql, values });
      if (sql.includes("LIMIT")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as DbPool;
  const authorizationService = {
    async requireWorkspaceAccess(input) {
      authorized.push(input);
      return {
        workspace: {
          id: input.workspaceId,
          type: "personal" as const,
          name: "Personal",
          status: "active" as const,
          planKey: "free",
          ownerUserId: input.userId,
        },
        member: { userId: input.userId, role: "owner" as const },
      };
    },
  } satisfies WorkspaceAuthorizationService;
  const service = createPostgresGenerationTaskRecordService(pool, {
    authorizationService,
  });
  const actor = {
    userId: "user_1",
    workspaceId: "44444444-4444-4444-8444-444444444444",
  };

  await service.record(validInput(), actor);
  await service.listMine(actor);

  // listMine 只按用户查询，不重复执行 workspace 授权。
  assert.deepEqual(authorized, [actor]);
  assert.deepEqual(queries[0]?.values.slice(0, 5), [
    actor.workspaceId,
    actor.userId,
    CLIENT_TASK_ID,
    "图像生成 #1a2b3c4d",
    "image",
  ]);
  assert.match(
    queries[0]?.sql ?? "",
    /ON CONFLICT \(user_id, client_task_id\)/,
  );
  assert.match(queries[1]?.sql ?? "", /WHERE user_id = \$1/);
  assert.match(queries[1]?.sql ?? "", /ORDER BY completed_at DESC, id DESC/);
  assert.doesNotMatch(
    JSON.stringify(queries),
    /prompt|endpoint|api.?key|remote.?task|negativePrompt|provider/i,
  );
});
