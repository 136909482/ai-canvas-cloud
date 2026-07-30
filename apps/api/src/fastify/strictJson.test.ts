import assert from "node:assert/strict";
import test from "node:test";
import { parseStrictJson, StrictJsonError } from "./strictJson.ts";

test("strict JSON parser accepts valid JSON and rejects duplicate keys", () => {
  assert.deepEqual(parseStrictJson(Buffer.from('{"value":1}')), { value: 1 });
  assert.throws(
    () => parseStrictJson(Buffer.from('{"value":1,"value":2}')),
    (error) =>
      error instanceof StrictJsonError &&
      /duplicate object keys/.test(error.message),
  );
});

test("strict JSON parser rejects invalid UTF-8 and unpaired Unicode", () => {
  assert.throws(
    () => parseStrictJson(Buffer.from([0xc3, 0x28])),
    /valid UTF-8/,
  );
  assert.throws(
    () => parseStrictJson(Buffer.from('{"value":"\\ud800"}')),
    /invalid Unicode/,
  );
});

test("strict JSON parser enforces depth and entry limits", () => {
  assert.throws(
    () => parseStrictJson(Buffer.from(`${"[".repeat(65)}0${"]".repeat(65)}`)),
    /structural limits/,
  );
  assert.throws(
    () =>
      parseStrictJson(
        Buffer.from(JSON.stringify(Array.from({ length: 100_001 }, () => 0))),
      ),
    /structural limits/,
  );
});
