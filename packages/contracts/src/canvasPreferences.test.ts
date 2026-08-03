import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { DEFAULT_CANVAS_PREFERENCES } from "./canvasPreferences.ts";
import {
  CanvasPreferencesResponseSchema,
  UpdateCanvasPreferencesRequestSchema,
} from "./httpSchema.ts";

test("canvas preferences contract accepts the complete default document", () => {
  assert.equal(
    Value.Check(CanvasPreferencesResponseSchema, {
      settings: DEFAULT_CANVAS_PREFERENCES,
      updatedAt: "2026-08-03T12:00:00.000Z",
    }),
    true,
  );
});

test("canvas preferences patch accepts supported partial updates", () => {
  assert.equal(
    Value.Check(UpdateCanvasPreferencesRequestSchema, {
      canvasPerformanceMode: "performance",
      lowQualityPreviewEnabled: false,
    }),
    true,
  );
});

test("canvas preferences patch rejects empty, unknown and sensitive fields", () => {
  assert.equal(Value.Check(UpdateCanvasPreferencesRequestSchema, {}), false);
  assert.equal(
    Value.Check(UpdateCanvasPreferencesRequestSchema, { apiKey: "secret" }),
    false,
  );
  assert.equal(
    Value.Check(UpdateCanvasPreferencesRequestSchema, {
      autosaveIntervalMs: 45_000,
    }),
    false,
  );
  assert.equal(
    Value.Check(UpdateCanvasPreferencesRequestSchema, {
      edgeStyle: "colorful",
    }),
    false,
  );
});
