import assert from "node:assert/strict";
import test from "node:test";
import {
  beginGenerationTelemetry,
  classifyGenerationFailure,
  completeGenerationTelemetry,
  restoreGenerationTelemetryAttempt,
} from "./generationTelemetry.ts";

test("generation telemetry sends only bounded lifecycle metadata", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(null, { status: 202 });
  };

  try {
    const attempt = beginGenerationTelemetry("image", {
      attemptId: "11111111-1111-4111-8111-111111111111",
      startedAt: Date.now() - 250,
    });
    completeGenerationTelemetry(attempt, {
      status: "failed",
      failureCategory: "network",
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url, "/api/v1/telemetry/generations");
    assert.equal(requests[0]?.init?.credentials, "include");
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      attemptId: attempt.attemptId,
      category: "image",
      status: "started",
    });
    const terminal = JSON.parse(String(requests[1]?.init?.body)) as Record<
      string,
      unknown
    >;
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.failureCategory, "network");
    assert.equal(typeof terminal.durationMs, "number");
    assert.deepEqual(Object.keys(terminal).sort(), [
      "attemptId",
      "category",
      "durationMs",
      "failureCategory",
      "status",
    ]);
    assert.doesNotMatch(
      JSON.stringify(requests.map((request) => request.init?.body)),
      /provider|model|endpoint|api.?key|prompt|content|response/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("restored remote telemetry does not emit another start event", () => {
  assert.deepEqual(
    restoreGenerationTelemetryAttempt({
      attemptId: "22222222-2222-4222-8222-222222222222",
      category: "video",
      startedAt: 1234,
    }),
    {
      attemptId: "22222222-2222-4222-8222-222222222222",
      category: "video",
      startedAt: 1234,
    },
  );
  assert.equal(
    restoreGenerationTelemetryAttempt({
      attemptId: null,
      category: "video",
      startedAt: 1234,
    }),
    null,
  );
});

test("generation failure classification never returns upstream text", () => {
  assert.equal(
    classifyGenerationFailure(new Error("HTTP 401 secret")),
    "authentication",
  );
  assert.equal(
    classifyGenerationFailure(new Error("HTTP 429 quota")),
    "rate_limited",
  );
  assert.equal(
    classifyGenerationFailure(new TypeError("Failed to fetch")),
    "network",
  );
  assert.equal(
    classifyGenerationFailure(new Error("HTTP 503 upstream")),
    "upstream",
  );
  assert.equal(
    classifyGenerationFailure(new Error("模型未返回可用内容")),
    "invalid_response",
  );
  assert.equal(
    classifyGenerationFailure(new Error("private opaque failure")),
    "unknown",
  );
});
