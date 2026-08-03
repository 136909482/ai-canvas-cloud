import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GENERATE_RATIO,
  SUPPORTED_GENERATE_RATIOS,
  normalizeGenerateRatio,
} from "../../constants/generateNode.ts";
import {
  downloadMediaAsBlob,
  getImageResultFromUnknown,
  resolveEffectiveRatio,
} from "./shared.ts";
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

test("Base64 media results decode locally without a fetch request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called for a data URL");
    },
  });

  try {
    const blob = await downloadMediaAsBlob(
      "data:image/png;charset=utf-8;base64,aGVsbG8td29ybGQ",
      "Generated image download",
    );

    assert.equal(fetchCalls, 0);
    assert.equal(blob.type, "image/png");
    assert.equal(await blob.text(), "hello-world");

    const urlSafeBlob = await downloadMediaAsBlob(
      "data:image/webp;base64,-_8",
      "Generated image download",
    );
    assert.deepEqual(
      new Uint8Array(await urlSafeBlob.arrayBuffer()),
      new Uint8Array([251, 255]),
    );
    await assert.rejects(
      downloadMediaAsBlob("data:image/png;base64,", "Generated image download"),
      /Invalid Base64 media payload/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
});

test("image responses prefer embedded Base64 over temporary URLs", () => {
  assert.equal(
    getImageResultFromUnknown({
      url: "https://cdn.example/temporary.png",
      b64_json: "aGVsbG8=",
    }),
    "data:image/png;base64,aGVsbG8=",
  );
});

test("image responses accept common explicit Base64 fields", () => {
  assert.equal(
    getImageResultFromUnknown({ image_base64: "aGVsbG8=" }),
    "data:image/png;base64,aGVsbG8=",
  );
});

test("unsupported and invalid generate ratios normalize to Auto", () => {
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

test("an unsupported explicit ratio follows Auto behavior", async () => {
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
