import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectAssetPath,
  buildWorkspaceThumbnailPath,
  getWorkspaceAssetPathParts,
} from "./projectAssetPaths.ts";

test("builds project-owned asset paths from stable project ids", () => {
  assert.deepEqual(
    buildProjectAssetPath("project-123", "generated", "2026-07-14"),
    ["projects", "project-123", "generated", "2026-07-14"],
  );
});

test("rejects project asset writes without an active project", () => {
  assert.throws(() => buildProjectAssetPath(null, "uploads"), /没有活动项目/);
});

test("keeps project thumbnails inside the owning project tree", () => {
  assert.deepEqual(
    buildWorkspaceThumbnailPath([
      "projects",
      "project-123",
      "generated",
      "2026-07-14",
    ]),
    ["projects", "project-123", "thumbnails", "generated", "2026-07-14"],
  );
});

test("rejects thumbnail paths outside a project tree", () => {
  assert.throws(
    () => buildWorkspaceThumbnailPath(["manual-uploads"]),
    /路径格式无效/,
  );
});

test("extracts path segments from existing workspace asset references", () => {
  assert.deepEqual(
    getWorkspaceAssetPathParts(
      "images/projects/project-123/uploads/photo.png",
      "fallback.png",
    ),
    {
      pathSegments: ["projects", "project-123", "uploads"],
      fileName: "photo.png",
    },
  );
});
