import assert from "node:assert/strict";
import test from "node:test";
import {
  createJsonLogger,
  hasDuplicateJsonObjectKeys,
  readOptionalEnv,
  readPortEnv,
  readRequiredEnv,
  redactSensitiveLogContext,
} from "./index.ts";

test("environment helpers validate required values and ports", () => {
  assert.equal(
    readRequiredEnv({ DATABASE_URL: " postgres://local " }, "DATABASE_URL"),
    "postgres://local",
  );
  assert.equal(readOptionalEnv({}, "LOG_LEVEL", "info"), "info");
  assert.equal(readPortEnv({ API_PORT: "8787" }, "API_PORT", 3000), 8787);
  assert.throws(() => readRequiredEnv({}, "DATABASE_URL"), /DATABASE_URL/);
  assert.throws(
    () => readPortEnv({ API_PORT: "70000" }, "API_PORT", 3000),
    /API_PORT/,
  );
});

test("duplicate JSON key detection covers nested and escaped aliases without false positives", () => {
  assert.equal(hasDuplicateJsonObjectKeys('{"a":1,"a":2}'), true);
  assert.equal(hasDuplicateJsonObjectKeys('{"a":1,"\\u0061":2}'), true);
  assert.equal(hasDuplicateJsonObjectKeys('{"a":{"b":1,"b":2}}'), true);
  assert.equal(hasDuplicateJsonObjectKeys('{"a":1,"b":{"a":2}}'), false);
  assert.equal(
    hasDuplicateJsonObjectKeys(String.raw`{"text":"\"a\":1,\"a\":2"}`),
    false,
  );
});

test("structured logger redacts credentials, signed URLs, object keys and response bodies", () => {
  const secret = "fixture-secret-value";
  const redacted = redactSensitiveLogContext({
    authorization: `Bearer ${secret}`,
    nested: {
      objectKey: "workspaces/private/asset.png",
      signedUrl: `https://storage.invalid/private?token=${secret}`,
      error: `request failed password=${secret} https://storage.invalid/private?token=${secret}`,
      providerResponse: `full response ${secret}`,
    },
  });
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("workspaces/private"), false);
  assert.equal(serialized.includes("full response"), false);

  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    createJsonLogger().info("security.fixture", {
      cookie: `session=${secret}`,
      error: `Bearer ${secret}`,
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes(secret), false);
});
