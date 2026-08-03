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
  shouldShowAuthenticatedHome,
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

test("authenticated users can open the public home without unloading their session", () => {
  assert.equal(
    shouldShowAuthenticatedHome("authenticated", true, false, "/home"),
    true,
  );
  assert.equal(
    shouldShowAuthenticatedHome("authenticated", true, false, "/home/"),
    true,
  );
  assert.equal(
    shouldShowAuthenticatedHome("authenticated", true, false, "/"),
    false,
  );
  assert.equal(
    shouldShowAuthenticatedHome("anonymous", false, false, "/home"),
    false,
  );
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

test("authentication dialog keeps readable dark controls under the public light theme", async () => {
  const css = await readFile("apps/web/src/index.css", "utf8");
  const authModal = css.match(/\.auth-modal\s*\{([\s\S]*?)\}/)?.[1];

  assert.ok(authModal, "authentication dialog styles must exist");
  assert.match(authModal, /color-scheme:\s*dark/);
  assert.match(authModal, /--text-primary:\s*#f7f7f4/);
  assert.match(authModal, /--text-secondary:\s*#d8d8d4/);
  assert.match(authModal, /--text-muted:\s*#a1a1aa/);
  assert.match(authModal, /--control-bg:\s*rgba\(255, 255, 255, 0\.06\)/);
});

test("authentication dialog closes only through explicit controls", async () => {
  const [source, css] = await Promise.all([
    readFile("apps/web/src/features/auth/AuthGate.tsx", "utf8"),
    readFile("apps/web/src/index.css", "utf8"),
  ]);
  const authBackdrop = css.match(/\.auth-modal-backdrop\s*\{([\s\S]*?)\}/)?.[1];
  const authModal = css.match(/\.auth-modal\s*\{([\s\S]*?)\}/)?.[1];

  assert.ok(authBackdrop, "authentication backdrop styles must exist");
  assert.ok(authModal, "authentication dialog styles must exist");
  assert.match(authBackdrop, /background:\s*rgba\(0, 0, 0, 0\.6\)/);
  assert.doesNotMatch(authBackdrop, /backdrop-filter/);
  assert.match(
    css,
    /body:has\(\.auth-modal-backdrop\) \.home-scene-node\s*\{[\s\S]*?box-shadow:\s*none/,
  );
  assert.match(authModal, /0 14px 32px rgba\(0, 0, 0, 0\.34\)/);
  assert.doesNotMatch(authModal, /100px/);
  assert.match(source, /event\.key === "Escape"[\s\S]*closeAuth\(\)/);
  assert.match(
    source,
    /className="auth-modal__close"[\s\S]*onClick=\{closeAuth\}/,
  );
  assert.doesNotMatch(source, /auth-modal-backdrop[\s\S]{0,240}onMouseDown/);
});
