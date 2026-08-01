import assert from "node:assert/strict";
import test from "node:test";
import {
  readWorkspaceConfigCache,
  writeWorkspaceConfigCache,
} from "./settingsCache.ts";

test("workspace cache stores only workspace settings", () => {
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
        autosaveIntervalMs: 60_000,
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
    writeWorkspaceConfigCache(config);
    assert.deepEqual(readWorkspaceConfigCache(), config);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
