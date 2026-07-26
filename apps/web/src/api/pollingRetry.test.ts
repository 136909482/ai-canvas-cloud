import assert from "node:assert/strict";
import test from "node:test";
import { fetchPollingRequestWithRetry } from "./pollingRetry.ts";

test("polling GET retries 429/5xx with bounded Retry-After delays", async () => {
  const responses = [
    new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "20" },
    }),
    new Response("temporary", { status: 503 }),
    new Response("ok", { status: 200 }),
  ];
  const delays: number[] = [];

  const response = await fetchPollingRequestWithRetry(
    async () =>
      responses.shift() ?? new Response("unexpected", { status: 500 }),
    {
      baseDelayMs: 100,
      maxDelayMs: 500,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(delays, [500, 200]);
});

test("polling GET retries network failures but stops at the limit", async () => {
  let attempts = 0;

  await assert.rejects(
    fetchPollingRequestWithRetry(
      async () => {
        attempts += 1;
        throw new TypeError("network unavailable");
      },
      {
        maxAttempts: 2,
        baseDelayMs: 0,
        sleep: async () => undefined,
      },
    ),
    /network unavailable/,
  );

  assert.equal(attempts, 2);
});

test("polling GET does not retry non-retryable HTTP responses", async () => {
  let attempts = 0;
  const response = await fetchPollingRequestWithRetry(async () => {
    attempts += 1;
    return new Response("unauthorized", { status: 401 });
  });

  assert.equal(response.status, 401);
  assert.equal(attempts, 1);
});
