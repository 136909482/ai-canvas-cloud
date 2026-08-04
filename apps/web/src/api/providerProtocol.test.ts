import assert from "node:assert/strict";
import test from "node:test";
import { buildChatCompletionsUrl } from "./chatAdapter.ts";
import {
  buildOpenAiTaskQueryUrl,
  resolveOpenAiEndpoint,
} from "./image/openai.ts";
import { buildTaskQueryUrl, buildVideoSynthesisUrl } from "./videoAdapter.ts";

test("chat requests use the fixed OpenAI-compatible completions path without a Cloud proxy", () => {
  const endpointWithoutVersion = buildChatCompletionsUrl(
    "https://gateway.example/tenant-a",
  );
  const endpointWithVersion = buildChatCompletionsUrl(
    "https://gateway.example/tenant-a/v1",
  );

  assert.equal(
    endpointWithoutVersion,
    "https://gateway.example/tenant-a/v1/chat/completions",
  );
  assert.equal(endpointWithoutVersion, endpointWithVersion);
  assert.equal(endpointWithoutVersion.includes("/api-proxy/"), false);
});

test("image requests only switch among fixed generation, edit, and task paths", () => {
  assert.equal(
    resolveOpenAiEndpoint(
      "https://gateway.example/tenant-a",
      "/v1/images/generations",
    ),
    "https://gateway.example/tenant-a/v1/images/generations",
  );
  assert.equal(
    resolveOpenAiEndpoint(
      "https://gateway.example/tenant-a/v1",
      "/v1/images/generations",
    ),
    "https://gateway.example/tenant-a/v1/images/generations",
  );
  assert.equal(
    resolveOpenAiEndpoint(
      "https://gateway.example/tenant-a/v1/images/generations",
      "/v1/images/edits",
    ),
    "https://gateway.example/tenant-a/v1/images/edits",
  );
  assert.equal(
    buildOpenAiTaskQueryUrl(
      "https://gateway.example/tenant-a/v1/images/generations",
      "task/with spaces",
    ),
    "https://gateway.example/tenant-a/v1/tasks/task%2Fwith%20spaces",
  );
});

test("Aliyun video requests discard configured paths and use fixed protocol endpoints", () => {
  const configured = "https://dashscope.example/arbitrary/path?target=/other";
  const submit = buildVideoSynthesisUrl(configured);
  const query = buildTaskQueryUrl(configured, "task/with spaces");

  assert.equal(
    submit,
    "https://dashscope.example/api/v1/services/aigc/video-generation/video-synthesis",
  );
  assert.equal(
    query,
    "https://dashscope.example/api/v1/tasks/task%2Fwith%20spaces",
  );
  assert.equal(submit.includes("/api-proxy/"), false);
});
