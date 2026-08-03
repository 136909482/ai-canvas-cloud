import assert from "node:assert/strict";
import test from "node:test";
import {
  readLegacyWorkspaceConfigCache,
  readWorkspaceConfigCache,
  removeLegacyWorkspaceConfigCache,
  writeWorkspaceConfigCache,
} from "./settingsCache.ts";

test("workspace cache isolates accounts and keeps pending cloud patches", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  });
  try {
    const config = {
      version: 1 as const,
      storage: {
        autosaveIntervalMs: 60_000 as const,
        canvasTopBarCollapsed: false,
        alignmentGuidesEnabled: true,
        incomingEdgeAnimationEnabled: true,
        themeMode: "dark" as const,
        canvasPerformanceMode: "quality" as const,
        canvasGridEnabled: true,
        edgeStyle: "animated" as const,
        lowQualityPreviewEnabled: true,
      },
    };
    const identityA = { userId: "user-a", workspaceId: "workspace-a" };
    const identityB = { userId: "user-b", workspaceId: "workspace-b" };
    writeWorkspaceConfigCache(identityA, config, {
      canvasPerformanceMode: "performance",
    });
    assert.deepEqual(readWorkspaceConfigCache(identityA), {
      version: 2,
      config,
      pendingPatch: { canvasPerformanceMode: "performance" },
    });
    assert.equal(readWorkspaceConfigCache(identityB), null);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("legacy workspace cache remains readable until cloud migration succeeds", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const legacyConfig = {
    version: 1 as const,
    storage: {
      autosaveIntervalMs: 60_000 as const,
      canvasTopBarCollapsed: false,
      alignmentGuidesEnabled: true,
      incomingEdgeAnimationEnabled: true,
      themeMode: "dark" as const,
      canvasPerformanceMode: "quality" as const,
      canvasGridEnabled: true,
      edgeStyle: "animated" as const,
      lowQualityPreviewEnabled: true,
    },
  };
  values.set("ai-canvas-workspace-config-cache", JSON.stringify(legacyConfig));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  });
  try {
    assert.deepEqual(readLegacyWorkspaceConfigCache(), legacyConfig);
    removeLegacyWorkspaceConfigCache();
    assert.equal(readLegacyWorkspaceConfigCache(), null);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
