import assert from "node:assert/strict";
import test from "node:test";
import { getModelBrand } from "./modelBrand.ts";

test("known model families resolve to their LobeHub brand icon", () => {
  const cases = [
    ["gpt-image-2", "openai"],
    ["claude-sonnet-4", "anthropic"],
    ["gemini-2.5-flash", "gemini"],
    ["qwen-image-max", "qwen"],
    ["deepseek-v3", "deepseek"],
    ["glm-4.7", "zhipu"],
  ] as const;

  for (const [modelId, expectedBrand] of cases) {
    assert.equal(getModelBrand({ modelId }), expectedBrand, modelId);
  }
});

test("Nano Banana models use the Google Gemini icon", () => {
  assert.equal(getModelBrand({ modelId: "nano-banana-pro" }), "gemini");
  assert.equal(
    getModelBrand({ modelId: "gemini-3.1-flash-image-preview" }),
    "gemini",
  );
});

test("unknown model names keep the generic model icon", () => {
  assert.equal(getModelBrand({ modelId: "private-image-model" }), null);
});
