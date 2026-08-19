import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEditImageFiles } from "./editMask";

test("keeps an edit mask whose pixel size already matches the source", async () => {
  const source = new File(["source"], "source.png", { type: "image/png" });
  const mask = new File(["mask"], "mask.png", { type: "image/png" });
  let resizeCalls = 0;

  const result = await normalizeEditImageFiles(source, mask, "1200x800", {
    decode: async () => ({ width: 1200, height: 800 }),
    resize: async () => {
      resizeCalls += 1;
      return new Blob();
    },
  });

  assert.equal(result.sourceFile, source);
  assert.equal(result.maskFile, mask);
  assert.equal(resizeCalls, 0);
});

test("resizes the edit image pair to the requested output pixel size", async () => {
  const source = new File(["source"], "source.jpg", { type: "image/jpeg" });
  const mask = new File(["mask"], "mask.png", { type: "image/png" });
  const decodedSizes = [
    { width: 5000, height: 3336 },
    { width: 1500, height: 1000 },
  ];

  const resizeCalls: Array<{
    width: number;
    height: number;
    mimeType: string;
    smooth: boolean;
  }> = [];
  const result = await normalizeEditImageFiles(source, mask, "1536x1024", {
    decode: async () => decodedSizes.shift()!,
    resize: async (_image, width, height, mimeType, smooth) => {
      resizeCalls.push({ width, height, mimeType, smooth });
      return new Blob(["resized"], { type: mimeType });
    },
  });

  assert.notEqual(result.sourceFile, source);
  assert.notEqual(result.maskFile, mask);
  assert.equal(result.sourceFile.type, "image/jpeg");
  assert.equal(result.maskFile.name, "mask.png");
  assert.equal(result.maskFile.type, "image/png");
  assert.deepEqual(resizeCalls, [
    {
      width: 1536,
      height: 1024,
      mimeType: "image/jpeg",
      smooth: true,
    },
    {
      width: 1536,
      height: 1024,
      mimeType: "image/png",
      smooth: false,
    },
  ]);
});
