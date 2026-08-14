import assert from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import test from "node:test";
import { UpdateCommunityPostRequestSchema } from "./httpSchema.js";

test("community post update accepts title with optional tags", () => {
  assert.equal(
    Value.Check(UpdateCommunityPostRequestSchema, {
      title: "A new title",
      tags: ["art", "landscape"],
    }),
    true,
  );
  assert.equal(
    Value.Check(UpdateCommunityPostRequestSchema, {
      title: "Title only",
    }),
    true,
  );
});

test("community post update rejects empty, oversized, and unknown input", () => {
  for (const input of [
    {},
    { title: "" },
    { title: "x".repeat(121) },
    { title: "ok", tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] },
    { title: "ok", tags: ["x".repeat(25)] },
    { title: "ok", assetId: "asset_1" },
    { title: 42 },
  ]) {
    assert.equal(Value.Check(UpdateCommunityPostRequestSchema, input), false);
  }
});
