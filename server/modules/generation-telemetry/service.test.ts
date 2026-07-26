import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../db/postgres.ts";
import { AuthServiceError } from "../auth/service.ts";
import type { WorkspaceAuthorizationService } from "../workspaces/authorization.ts";
import {
  createPostgresGenerationTelemetryService,
  validateGenerationTelemetryRequest,
} from "./service.ts";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

test("generation telemetry validation accepts bounded lifecycle states", () => {
  assert.deepEqual(
    validateGenerationTelemetryRequest({
      attemptId: ATTEMPT_ID.toUpperCase(),
      category: "image",
      status: "started",
    }),
    {
      attemptId: ATTEMPT_ID,
      category: "image",
      status: "started",
    },
  );
  assert.deepEqual(
    validateGenerationTelemetryRequest({
      attemptId: ATTEMPT_ID,
      category: "text",
      status: "succeeded",
      durationMs: 1250,
      resultCount: 1,
    }),
    {
      attemptId: ATTEMPT_ID,
      category: "text",
      status: "succeeded",
      durationMs: 1250,
      resultCount: 1,
    },
  );
  assert.deepEqual(
    validateGenerationTelemetryRequest({
      attemptId: ATTEMPT_ID,
      category: "video",
      status: "failed",
      durationMs: 5000,
      failureCategory: "upstream",
    }),
    {
      attemptId: ATTEMPT_ID,
      category: "video",
      status: "failed",
      durationMs: 5000,
      failureCategory: "upstream",
    },
  );
});

test("generation telemetry validation rejects private and unbounded fields", () => {
  for (const input of [
    {
      attemptId: ATTEMPT_ID,
      category: "image",
      status: "started",
      provider: "private-provider",
    },
    {
      attemptId: ATTEMPT_ID,
      category: "image",
      status: "failed",
      durationMs: 10,
      failureCategory: "private-upstream-body",
    },
    {
      attemptId: ATTEMPT_ID,
      category: "image",
      status: "succeeded",
      durationMs: 86_400_001,
      resultCount: 1,
    },
  ]) {
    assert.throws(
      () => validateGenerationTelemetryRequest(input),
      (error) =>
        error instanceof AuthServiceError &&
        error.apiCode === "VALIDATION_FAILED",
    );
  }
});

test("postgres telemetry uses the trusted actor and terminal-only conflict update", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const authorized: unknown[] = [];
  const pool = {
    async query(sql: string, values: unknown[]) {
      queries.push({ sql, values });
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
  const service = createPostgresGenerationTelemetryService(pool, {
    authorizationService,
  });
  const actor = {
    userId: "user_1",
    workspaceId: "22222222-2222-4222-8222-222222222222",
  };

  await service.record(
    {
      attemptId: ATTEMPT_ID,
      category: "image",
      status: "started",
    },
    actor,
  );
  await service.record(
    {
      attemptId: ATTEMPT_ID,
      category: "image",
      status: "failed",
      durationMs: 900,
      failureCategory: "network",
    },
    actor,
  );

  assert.deepEqual(authorized, [actor, actor]);
  assert.deepEqual(queries[0]?.values.slice(0, 5), [
    actor.workspaceId,
    actor.userId,
    ATTEMPT_ID,
    "image",
    "started",
  ]);
  assert.deepEqual(queries[1]?.values.slice(5), ["network", 0, 900]);
  assert.match(queries[0]?.sql ?? "", /ON CONFLICT/);
  assert.match(
    queries[0]?.sql ?? "",
    /generation_telemetry\.status = 'started'/,
  );
  assert.doesNotMatch(
    JSON.stringify(queries),
    /provider|model|endpoint|api.?key|prompt|response.body/i,
  );
});
