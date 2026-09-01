import assert from "node:assert/strict";
import test from "node:test";
import {
  isOfficialModelReference,
  parseModelSelectionRef,
  serializeModelSelectionRef,
} from "./modelReference.ts";

test("official and custom model references remain source-safe", () => {
  const modelId = "123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(parseModelSelectionRef(`official:${modelId}`), {
    source: "official",
    modelId,
  });
  assert.deepEqual(parseModelSelectionRef("vault-model"), {
    source: "custom",
    modelEntryId: "vault-model",
  });
  assert.equal(
    serializeModelSelectionRef({ source: "official", modelId }),
    `official:${modelId}`,
  );
  assert.equal(isOfficialModelReference("vault-model"), false);
});
