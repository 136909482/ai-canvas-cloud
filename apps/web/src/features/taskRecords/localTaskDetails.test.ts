import assert from "node:assert/strict";
import test from "node:test";
import type { GenerateTask } from "@/types";
import {
  buildLocalTaskDetail,
  decryptLocalTaskDetail,
  encryptLocalTaskDetail,
} from "./localTaskDetails.ts";

function createTask(overrides: Partial<GenerateTask> = {}): GenerateTask {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    displayId: "1a2b3c4d",
    projectId: null,
    kind: "image",
    sourceNodeId: "node_1",
    previewNodeId: "node_2",
    model: "测试模型",
    prompt: "一只在雪地里的柴犬，电影感光",
    negativePrompt: "模糊，低清",
    ratio: "16:9",
    resolution: "2K",
    operationType: "text-to-image",
    sourceImageNodeId: null,
    maskImageUrl: null,
    referenceImages: [],
    status: "running",
    phase: "polling",
    errorMsg: "",
    remoteTaskId: null,
    remoteStatus: null,
    createdAt: 1_752_000_000_000,
    startedAt: 1_752_000_000_000,
    finishedAt: 1_752_000_010_000,
    ...overrides,
  } as GenerateTask;
}

test("local task detail encrypt/decrypt round-trips sensitive fields", async () => {
  const key = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const task = createTask();
  const detail = buildLocalTaskDetail(
    task,
    { status: "succeeded", resultCount: 1 },
    "user_1",
  );
  const record = await encryptLocalTaskDetail(detail, key);
  const decrypted = await decryptLocalTaskDetail(
    record,
    key,
    "user_1",
    task.id,
  );
  assert.equal(decrypted.prompt, "一只在雪地里的柴犬，电影感光");
  assert.equal(decrypted.negativePrompt, "模糊，低清");
  assert.equal(decrypted.model, "测试模型");
  assert.equal(decrypted.status, "succeeded");
  assert.equal(decrypted.clientTaskId, task.id);
});

test("local task detail decryption binds to user and task", async () => {
  const key = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const task = createTask();
  const detail = buildLocalTaskDetail(
    task,
    { status: "failed", failureCategory: "network" },
    "user_1",
  );
  const record = await encryptLocalTaskDetail(detail, key);
  await assert.rejects(() =>
    decryptLocalTaskDetail(record, key, "user_2", task.id),
  );
  await assert.rejects(() =>
    decryptLocalTaskDetail(
      record,
      key,
      "user_1",
      "22222222-2222-4222-8222-222222222222",
    ),
  );
});

test("buildLocalTaskDetail keeps sensitive details local and references assets", async () => {
  const task = createTask({
    apiProfileId: "33333333-3333-4333-8333-333333333333",
    apiProfileName: "我的服务商",
    provider: "dashscope",
    errorMsg: "上游返回 500：bad gateway",
    resultImageAsset: {
      assetId: "44444444-4444-4444-8444-444444444444",
      relativePath: "assets/result.png",
      mimeType: "image/png",
      fileName: "result.png",
    },
  });
  const detail = buildLocalTaskDetail(
    task,
    { status: "failed", failureCategory: "upstream" },
    "user_1",
  );
  assert.equal(detail.provider, "dashscope");
  assert.equal(detail.errorMsg, "上游返回 500：bad gateway");
  assert.deepEqual(detail.resultAssetIds, [
    "44444444-4444-4444-8444-444444444444",
  ]);
  assert.equal(detail.operationType, "text-to-image");
  assert.equal(detail.finishedAt, task.finishedAt);
});
