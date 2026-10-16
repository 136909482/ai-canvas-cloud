import assert from "node:assert/strict";
import test from "node:test";
import { resolveOfficialImageParameterTemplate } from "@ai-canvas-cloud/contracts";
import {
  buildOfficialImageProviderRequest,
  type OfficialImageRequestSnapshot,
} from "./imageRequest.js";

const base: OfficialImageRequestSnapshot = {
  projectId: "project",
  clientTaskId: "task",
  idempotencyKey: "test-task",
  modelId: "public-id",
  resolution: "2K",
  ratio: "16:9",
  operationType: "generate",
  prompt: "风景",
  quality: "high",
  background: "transparent",
};
const images = new Map([
  [
    "reference",
    { bytes: Buffer.from("reference image"), mimeType: "image/png" },
  ],
  [
    "original",
    { bytes: Buffer.from("original image"), mimeType: "image/jpeg" },
  ],
  ["mask", { bytes: Buffer.from("mask image"), mimeType: "image/png" }],
]);

test("official templates auto-detect upstream identifiers and allow explicit overrides", () => {
  for (const id of ["gpt-image-1", "openai/gpt-image-2", "gpt_image_1.5"])
    assert.equal(
      resolveOfficialImageParameterTemplate("auto", id),
      "gpt-image",
    );
  for (const id of [
    "nano-banana",
    "nano-banana-2",
    "nano-banana-pro",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
  ])
    assert.equal(
      resolveOfficialImageParameterTemplate("auto", id),
      "nano-banana",
    );
  assert.equal(
    resolveOfficialImageParameterTemplate("auto", "other-image"),
    "generic",
  );
  assert.equal(
    resolveOfficialImageParameterTemplate("gpt-image", "private-alias"),
    "gpt-image",
  );
  assert.equal(
    resolveOfficialImageParameterTemplate("generic", "gpt-image-2"),
    "generic",
  );
});

test("GPT generation sends selected quality and PNG background independently of the public model name", () => {
  for (const quality of ["auto", "low", "medium", "high"] as const) {
    for (const background of ["auto", "opaque", "transparent"] as const) {
      const result = buildOfficialImageProviderRequest({
        request: {
          ...base,
          parameterTemplate: "gpt-image",
          quality,
          background,
        },
        modelId: "private-alias",
        size: "2048x1152",
        inputs: new Map(),
      });
      const payload = JSON.parse(result.body as string);
      assert.equal(result.operation, "generate");
      assert.equal(payload.quality, quality);
      assert.equal(
        payload.background,
        background === "auto" ? undefined : background,
      );
      assert.equal(payload.output_format, "png");
      assert.equal(payload.image_size, undefined);
    }
  }
});

test("GPT edit forwards quality and background alongside ordered reference files and mask", async () => {
  const result = buildOfficialImageProviderRequest({
    request: {
      ...base,
      parameterTemplate: "gpt-image",
      operationType: "edit",
      inputAssetIds: ["reference"],
      editAssetId: "original",
      maskAssetId: "mask",
    },
    modelId: "alias",
    size: "2048x1152",
    inputs: images,
  });
  assert.equal(result.operation, "edit");
  assert.ok(result.body instanceof FormData);
  assert.equal(result.body.get("quality"), "high");
  assert.equal(result.body.get("background"), "transparent");
  const files = result.body.getAll("image") as File[];
  assert.equal(await files[0].text(), "reference image");
  assert.equal(await files[1].text(), "original image");
  assert.equal(await (result.body.get("mask") as File).text(), "mask image");
});

test("Nano Banana uses its own JSON image parameters and keeps private assets inline and ordered", () => {
  const result = buildOfficialImageProviderRequest({
    request: {
      ...base,
      parameterTemplate: "nano-banana",
      operationType: "edit",
      inputAssetIds: ["reference"],
      editAssetId: "original",
    },
    modelId: "alias",
    size: "2048x1152",
    inputs: images,
  });
  assert.equal(result.operation, "generate");
  const payload = JSON.parse(result.body as string);
  assert.equal(payload.image_size, "2K");
  assert.equal(payload.aspect_ratio, "16:9");
  assert.deepEqual(payload.image_urls, [
    "data:image/png;base64," +
      images.get("reference")!.bytes.toString("base64"),
    "data:image/jpeg;base64," +
      images.get("original")!.bytes.toString("base64"),
  ]);
  for (const key of ["quality", "background", "size", "n"])
    assert.equal(key in payload, false);
  assert.throws(
    () =>
      buildOfficialImageProviderRequest({
        request: {
          ...base,
          parameterTemplate: "nano-banana",
          maskAssetId: "mask",
        },
        modelId: "alias",
        size: "auto",
        inputs: images,
      }),
    /不支持蒙版/,
  );
});

test("generic override discards stale GPT settings and legacy snapshots still resolve", () => {
  const result = buildOfficialImageProviderRequest({
    request: { ...base, parameterTemplate: "generic" },
    modelId: "gpt-image-2",
    size: "1024x1024",
    inputs: new Map(),
  });
  const payload = JSON.parse(result.body as string);
  assert.equal(payload.quality, undefined);
  assert.equal(payload.background, undefined);
  assert.equal(payload.size, "1024x1024");
  const legacy = buildOfficialImageProviderRequest({
    request: { ...base, quality: undefined, background: undefined },
    modelId: "gpt-image-1",
    size: "1024x1024",
    inputs: new Map(),
  });
  assert.equal(JSON.parse(legacy.body as string).quality, "auto");
});
