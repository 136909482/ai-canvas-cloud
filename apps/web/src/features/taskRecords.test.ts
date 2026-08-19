import assert from "node:assert/strict";
import test from "node:test";
import type { GenerateTask } from "@/types";
import {
  backfillTerminalTaskRecords,
  getTaskRecordModelEntryId,
} from "./taskRecords.ts";

test("task records reference the model entry rather than the provider profile", () => {
  assert.equal(
    getTaskRecordModelEntryId({
      model: "22222222-2222-4222-8222-222222222222",
    }),
    "22222222-2222-4222-8222-222222222222",
  );
});

test("task records omit legacy upstream model names", () => {
  assert.equal(
    getTaskRecordModelEntryId({ model: "gemini-2.5-flash-image" }),
    null,
  );
  assert.equal(getTaskRecordModelEntryId({ model: "" }), null);
});

test("task record backfill submits only recent UUID terminal tasks", async () => {
  const originalFetch = globalThis.fetch;
  const submitted: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    submitted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(null, { status: 202 });
  }) as typeof fetch;

  const baseTask = {
    id: "11111111-1111-4111-8111-111111111111",
    displayId: "abc12345",
    kind: "image",
    model: "22222222-2222-4222-8222-222222222222",
    status: "done",
    startedAt: 1_000,
    finishedAt: 2_000,
  } as GenerateTask;

  try {
    await backfillTerminalTaskRecords([
      baseTask,
      { ...baseTask, id: "legacy-task-id" },
      {
        ...baseTask,
        id: "33333333-3333-4333-8333-333333333333",
        status: "running",
        finishedAt: null,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]?.clientTaskId, baseTask.id);
  assert.equal(submitted[0]?.modelEntryId, baseTask.model);
});
