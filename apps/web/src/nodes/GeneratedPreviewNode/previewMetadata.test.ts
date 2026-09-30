import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreviewModelLabel } from "./previewMetadata.ts";

test("official preview titles prefer the persisted public model name", () => {
  assert.equal(
    resolvePreviewModelLabel(
      "official:4820e6f8-2c90-4a33-8347-5f88aefb4cc3",
      "gpt-image-2.5-sunburst",
    ),
    "gpt-image-2.5-sunburst",
  );
});

test("official preview titles never expose the internal model id", () => {
  assert.equal(
    resolvePreviewModelLabel("official:4820e6f8-2c90-4a33-8347-5f88aefb4cc3"),
    "官方模型",
  );
});
