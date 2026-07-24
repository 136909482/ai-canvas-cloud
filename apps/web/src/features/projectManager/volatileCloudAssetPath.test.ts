import assert from "node:assert/strict";
import test from "node:test";
import { isVolatileCloudMemoryAssetPath } from "./volatileCloudAssetPath.ts";

test("recognizes obsolete in-memory Cloud asset locators", () => {
  assert.equal(
    isVolatileCloudMemoryAssetPath(
      "cloud-memory/projects/project-1/uploads/image.png",
    ),
    true,
  );
  assert.equal(
    isVolatileCloudMemoryAssetPath(
      "/cloud-memory/projects/project-1/uploads/image.png",
    ),
    true,
  );
  assert.equal(
    isVolatileCloudMemoryAssetPath(
      "cloud-assets/66666666-6666-4666-8666-666666666666",
    ),
    false,
  );
  assert.equal(
    isVolatileCloudMemoryAssetPath("images/originals/image.png"),
    false,
  );
});
