import assert from "node:assert/strict";
import test from "node:test";
import type { OfficialModelSummary } from "@ai-canvas-cloud/contracts";
import { getOfficialModelCreditCost } from "./modelPricing";

const models: OfficialModelSummary[] = [
  {
    id: "image-model",
    name: "官方图片模型",
    capabilities: { generate: true, edit: true, references: true },
    prices: { "1K": 8, "2K": 12, "4K": null },
  },
  {
    id: "other-model",
    name: "另一个模型",
    capabilities: { generate: true, edit: false, references: false },
    prices: { "1K": 16, "2K": 24, "4K": 32 },
  },
];

test("send estimate uses the selected official model and current resolution price", () => {
  assert.equal(
    getOfficialModelCreditCost("official:image-model", "1K", models),
    8,
  );
  assert.equal(
    getOfficialModelCreditCost("official:image-model", "2K", models),
    12,
  );
  assert.equal(
    getOfficialModelCreditCost("official:other-model", "2K", models),
    24,
  );
});

test("custom models never show platform credit consumption, even with the same model id", () => {
  assert.equal(getOfficialModelCreditCost("image-model", "1K", models), null);
  assert.equal(getOfficialModelCreditCost("", "1K", models), null);
});

test("send estimate totals the selected number of images while model listings keep unit prices", () => {
  for (const count of [1, 2, 4]) {
    assert.equal(
      getOfficialModelCreditCost("official:image-model", "2K", models, count),
      12 * count,
    );
    assert.equal(
      getOfficialModelCreditCost("image-model", "2K", models, count),
      null,
    );
    assert.equal(
      getOfficialModelCreditCost("official:image-model", "4K", models, count),
      null,
    );
  }
  assert.equal(
    getOfficialModelCreditCost("official:image-model", "2K", models),
    12,
  );
});

test("unavailable models or resolutions do not invent a zero or fallback price", () => {
  assert.equal(
    getOfficialModelCreditCost("official:image-model", "4K", models),
    null,
  );
  assert.equal(
    getOfficialModelCreditCost("official:deleted", "1K", models),
    null,
  );
  assert.equal(
    getOfficialModelCreditCost("official:image-model", "8K", models),
    null,
  );
  assert.equal(
    getOfficialModelCreditCost("official:image-model", "1K", []),
    null,
  );
});
