import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GENERATE_RATIO,
  SUPPORTED_GENERATE_RATIOS,
  normalizeGenerateRatio,
} from "../../constants/generateNode.ts";
import { resolveEffectiveRatio } from "./shared.ts";
import type { GenerateImageParams } from "./types.ts";

function createParams(
  patch: Partial<GenerateImageParams> = {},
): GenerateImageParams {
  return {
    prompt: "draw",
    apiKey: "key",
    apiUrl: "https://images.example/v1",
    model: "gpt-image-2",
    ...patch,
  };
}

test("generate ratio options match the documented provider ratios", () => {
  assert.deepEqual(SUPPORTED_GENERATE_RATIOS, [
    "1:1",
    "3:2",
    "2:3",
    "4:3",
    "3:4",
    "5:4",
    "4:5",
    "16:9",
    "9:16",
    "2:1",
    "1:2",
    "3:1",
    "1:3",
    "21:9",
    "9:21",
  ]);
});

test("legacy and invalid generate ratios normalize to Auto", () => {
  assert.equal(normalizeGenerateRatio("16:9"), "16:9");
  assert.equal(normalizeGenerateRatio("8:1"), DEFAULT_GENERATE_RATIO);
  assert.equal(normalizeGenerateRatio("1:4"), DEFAULT_GENERATE_RATIO);
  assert.equal(normalizeGenerateRatio(undefined), DEFAULT_GENERATE_RATIO);
});

test("Auto snaps a prompt ratio to the closest documented ratio", async () => {
  assert.equal(
    await resolveEffectiveRatio(
      createParams({ ratio: "Auto", prompt: "wide banner at 8:1" }),
    ),
    "3:1",
  );
});

test("a legacy explicit ratio follows Auto compatibility behavior", async () => {
  assert.equal(
    await resolveEffectiveRatio(
      createParams({ ratio: "8:1", prompt: "portrait at 9:21" }),
    ),
    "9:21",
  );
});

test("Auto derives the closest documented ratio from the reference image", async () => {
  const originalImage = globalThis.Image;

  class ReferenceImage {
    naturalWidth = 2000;
    naturalHeight = 1000;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    writable: true,
    value: ReferenceImage,
  });

  try {
    assert.equal(
      await resolveEffectiveRatio(
        createParams({
          ratio: "Auto",
          referenceImageUrl: "https://assets.example/reference.png",
          operationType: "image-to-image",
        }),
      ),
      "2:1",
    );
  } finally {
    if (originalImage) {
      Object.defineProperty(globalThis, "Image", {
        configurable: true,
        writable: true,
        value: originalImage,
      });
    } else {
      Reflect.deleteProperty(globalThis, "Image");
    }
  }
});
