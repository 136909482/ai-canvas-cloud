import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRefurnishPrompt,
  createInteriorRefurnishNodeData,
  parseRecognizedParts,
} from "./runtime.ts";

test("parseRecognizedParts accepts fenced JSON and removes duplicates", () => {
  assert.deepEqual(
    parseRecognizedParts('```json\n{"parts":["沙发","茶几","沙发"]}\n```'),
    ["沙发", "茶几"],
  );
});

test("parseRecognizedParts rejects invalid or empty output and caps at 15", () => {
  assert.deepEqual(parseRecognizedParts("not json"), []);
  assert.deepEqual(parseRecognizedParts('{"parts":[]}'), []);
  assert.equal(
    parseRecognizedParts(
      JSON.stringify({
        parts: Array.from({ length: 20 }, (_, i) => `部件${i}`),
      }),
    ).length,
    15,
  );
});

test("buildRefurnishPrompt preserves image order and truncates requirements", () => {
  const prompt = buildRefurnishPrompt(
    [
      { sourceNodeId: "sofa", partName: "沙发" },
      { sourceNodeId: "table", partName: "茶几" },
    ],
    `暖色；不要改变窗户 ${"字".repeat(400)}`,
  );
  assert.match(prompt, /图2中的沙发/);
  assert.match(prompt, /图3中的茶几/);
  assert.match(prompt, /补充要求：暖色；不要改变窗户/);
  assert.ok(prompt.length < 900);
});

test("node data sanitizer keeps only connected unique bindings", () => {
  const data = createInteriorRefurnishNodeData({
    productSourceOrder: ["a", "b"],
    bindings: [
      { sourceNodeId: "a", partName: "沙发" },
      { sourceNodeId: "b", partName: "沙发" },
      { sourceNodeId: "missing", partName: "灯具" },
    ],
  });
  assert.deepEqual(data.bindings, [{ sourceNodeId: "a", partName: "沙发" }]);
});

test("node data sanitizer restores bounded adaptive content heights", () => {
  assert.equal(
    createInteriorRefurnishNodeData({ autoResizeHeight: 920 }).autoResizeHeight,
    920,
  );
  assert.equal(
    createInteriorRefurnishNodeData({ autoResizeHeight: 5000 })
      .autoResizeHeight,
    null,
  );
});
