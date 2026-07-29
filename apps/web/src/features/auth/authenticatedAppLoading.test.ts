import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clearAuthenticatedRuntime,
  registerAuthenticatedRuntimeCleanup,
} from "./useAuthStore.ts";
import {
  isChunkLoadError,
  shouldLoadAuthenticatedApp,
} from "./authenticatedAppLoading.ts";

test("authenticated application loads only for a confirmed usable session", () => {
  assert.equal(shouldLoadAuthenticatedApp("checking", false, false), false);
  assert.equal(shouldLoadAuthenticatedApp("anonymous", false, false), false);
  assert.equal(
    shouldLoadAuthenticatedApp("authenticated", false, false),
    false,
  );
  assert.equal(shouldLoadAuthenticatedApp("authenticated", true, true), false);
  assert.equal(shouldLoadAuthenticatedApp("authenticated", true, false), true);
});

test("dynamic import failures are recognized for refresh recovery", () => {
  assert.equal(
    isChunkLoadError(
      new TypeError("Failed to fetch dynamically imported module"),
    ),
    true,
  );
  assert.equal(
    isChunkLoadError(new Error("ChunkLoadError: loading failed")),
    true,
  );
  assert.equal(isChunkLoadError(new Error("ordinary render failure")), false);
});

test("authenticated runtime cleanup is registered without static store imports", async () => {
  let cleanupCount = 0;
  registerAuthenticatedRuntimeCleanup(() => {
    cleanupCount += 1;
  });
  clearAuthenticatedRuntime();
  assert.equal(cleanupCount, 1);

  const source = await readFile(
    "apps/web/src/features/auth/useAuthStore.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /store\/(?:useProjectStore|useSettingsStore)/);
});

test("anonymous application entry has no static canvas imports", async () => {
  const source = await readFile("apps/web/src/App.tsx", "utf8");

  assert.match(source, /lazy\(\(\) => import\("@\/AuthenticatedApp"\)\)/);
  assert.match(source, /<AuthGate>[\s\S]*<AuthenticatedAppHost \/>/);
  assert.doesNotMatch(
    source,
    /@xyflow|components\/(?:Canvas|Toolbar|ProjectBootstrap|TaskQueueRunner)|store\/useProjectStore/,
  );
});
