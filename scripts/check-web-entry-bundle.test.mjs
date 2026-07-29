import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FORBIDDEN_ENTRY_CHUNKS,
  getAnonymousEntryReferences,
  inspectAnonymousEntry,
} from "./check-web-entry-bundle.mjs";

function fixture(html, resources) {
  const root = mkdtempSync(join(tmpdir(), "ai-canvas-entry-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), html);
  for (const [name, content] of Object.entries(resources)) {
    writeFileSync(join(root, "assets", name), content);
  }
  return root;
}

test("anonymous entry parser includes scripts, styles, and module preloads", () => {
  assert.deepEqual(
    getAnonymousEntryReferences(`
      <script type="module" src="/assets/index-a.js"></script>
      <link rel="stylesheet" href="/assets/index-a.css">
      <link rel="modulepreload" href="/assets/vendor-react-a.js">
      <link rel="icon" href="/favicon.ico">
    `),
    ["/assets/index-a.js", "/assets/index-a.css", "/assets/vendor-react-a.js"],
  );
});

test("anonymous entry budget counts gzip bytes", () => {
  const root = fixture(
    '<script type="module" src="/assets/index-a.js"></script><link rel="stylesheet" href="/assets/index-a.css">',
    { "index-a.js": "const ready = true;", "index-a.css": "body{color:#111}" },
  );
  try {
    const result = inspectAnonymousEntry(root, { limitBytes: 1024 });
    assert.equal(result.resources.length, 2);
    assert.ok(result.gzipBytes > 0);
    assert.throws(
      () => inspectAnonymousEntry(root, { limitBytes: 1 }),
      /limit is/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("anonymous entry rejects every authenticated module preload", () => {
  const links = FORBIDDEN_ENTRY_CHUNKS.map(
    (chunkName) =>
      `<link rel="modulepreload" href="/assets/${chunkName}-a.js">`,
  ).join("");
  const root = fixture(
    links.replace("authenticatedapp", "AuthenticatedApp"),
    {},
  );
  try {
    assert.throws(
      () => inspectAnonymousEntry(root),
      /preloads authenticated chunks/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
