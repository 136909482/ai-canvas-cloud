import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  scanWebBundle,
  validateCleanupAudit,
} from "./staging-release-gate.mjs";

function bundle(content) {
  const root = mkdtempSync(join(tmpdir(), "ai-canvas-web-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    '<script type="module" src="/assets/app.js"></script>',
  );
  writeFileSync(join(root, "assets", "app.js"), content);
  return root;
}

test("web bundle rejects local dev endpoints and secret markers", () => {
  assert.throws(
    () => scanWebBundle(bundle('fetch("http://127.0.0.1:8787")')),
    /forbidden/,
  );
  assert.throws(
    () => scanWebBundle(bundle("const key = OPENAI_API_KEY")),
    /forbidden/,
  );
});

test("web bundle accepts production-safe static content", () => {
  assert.deepEqual(scanWebBundle(bundle('fetch("/api/health/live")')), {
    files: 2,
  });
});

test("cleanup audit requires zero unreconciled staging state", () => {
  assert.equal(
    validateCleanupAudit({
      orphanFormalAssets: 0,
      permanentRunningTasks: 0,
      duplicateCharges: 0,
      unreclaimableStagingObjects: 0,
    }),
    true,
  );
  assert.throws(
    () => validateCleanupAudit({ orphanFormalAssets: 1 }),
    /orphanFormalAssets/,
  );
  assert.throws(() => validateCleanupAudit({}), /required/);
});
