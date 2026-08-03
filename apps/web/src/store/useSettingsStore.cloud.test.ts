import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CANVAS_PREFERENCES } from "@ai-canvas-cloud/contracts/canvas-preferences";
import { platformBridge } from "../platform/index.ts";
import type { WorkspaceConfigFile } from "../types/index.ts";
import { readWorkspaceConfigCache } from "./settingsCache.ts";
import { useSettingsStore } from "./useSettingsStore.ts";

function installLocalStorage() {
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
  return {
    values,
    restore() {
      if (originalWindow)
        Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

test("first cloud settings hydration seeds the account from legacy local settings", async () => {
  const local = installLocalStorage();
  const originalLoad = platformBridge.loadWorkspaceConfig;
  const originalSave = platformBridge.saveWorkspaceConfig;
  const savedPatches: Array<Partial<WorkspaceConfigFile["storage"]>> = [];
  let serverSettings: WorkspaceConfigFile["storage"] | null = null;
  const legacyConfig: WorkspaceConfigFile = {
    version: 1,
    storage: {
      ...DEFAULT_CANVAS_PREFERENCES,
      canvasPerformanceMode: "performance",
      lowQualityPreviewEnabled: false,
    },
  };
  local.values.set(
    "ai-canvas-workspace-config-cache",
    JSON.stringify(legacyConfig),
  );

  platformBridge.loadWorkspaceConfig = async () =>
    serverSettings ? { version: 1, storage: serverSettings } : null;
  platformBridge.saveWorkspaceConfig = async (patch) => {
    savedPatches.push(patch);
    serverSettings = {
      ...DEFAULT_CANVAS_PREFERENCES,
      ...serverSettings,
      ...patch,
    };
    return { version: 1, storage: serverSettings };
  };

  try {
    useSettingsStore.getState().clearVaultSession();
    useSettingsStore.getState().setWorkspaceRuntimeStatus({
      configured: true,
      directoryName: "Personal",
      permission: "granted",
    });
    await useSettingsStore
      .getState()
      .hydrateFromWorkspace("user-a", "workspace-a");

    assert.equal(savedPatches.length, 1);
    assert.equal(savedPatches[0]?.canvasPerformanceMode, "performance");
    assert.equal(savedPatches[0]?.lowQualityPreviewEnabled, false);
    assert.equal(
      useSettingsStore.getState().config.storage.canvasPerformanceMode,
      "performance",
    );
    assert.equal(local.values.has("ai-canvas-workspace-config-cache"), false);
    assert.deepEqual(
      readWorkspaceConfigCache({
        userId: "user-a",
        workspaceId: "workspace-a",
      })?.pendingPatch,
      {},
    );

    await useSettingsStore
      .getState()
      .updateStorageSettings({ themeMode: "light" });
    assert.equal(
      (serverSettings as WorkspaceConfigFile["storage"] | null)?.themeMode,
      "light",
    );
  } finally {
    platformBridge.loadWorkspaceConfig = originalLoad;
    platformBridge.saveWorkspaceConfig = originalSave;
    useSettingsStore.getState().clearVaultSession();
    local.restore();
  }
});

test("existing cloud settings win over an unscoped legacy cache", async () => {
  const local = installLocalStorage();
  const originalLoad = platformBridge.loadWorkspaceConfig;
  const originalSave = platformBridge.saveWorkspaceConfig;
  local.values.set(
    "ai-canvas-workspace-config-cache",
    JSON.stringify({
      version: 1,
      storage: {
        ...DEFAULT_CANVAS_PREFERENCES,
        canvasPerformanceMode: "performance",
      },
    }),
  );
  platformBridge.loadWorkspaceConfig = async () => ({
    version: 1,
    storage: { ...DEFAULT_CANVAS_PREFERENCES, themeMode: "light" },
  });
  platformBridge.saveWorkspaceConfig = async () => {
    throw new Error("save should not be called");
  };

  try {
    useSettingsStore.getState().clearVaultSession();
    await useSettingsStore
      .getState()
      .hydrateFromWorkspace("user-b", "workspace-b");
    assert.equal(useSettingsStore.getState().config.storage.themeMode, "light");
    assert.equal(
      useSettingsStore.getState().config.storage.canvasPerformanceMode,
      "quality",
    );
  } finally {
    platformBridge.loadWorkspaceConfig = originalLoad;
    platformBridge.saveWorkspaceConfig = originalSave;
    useSettingsStore.getState().clearVaultSession();
    local.restore();
  }
});

test("failed cloud patches remain pending and retry on the next hydration", async () => {
  const local = installLocalStorage();
  const originalLoad = platformBridge.loadWorkspaceConfig;
  const originalSave = platformBridge.saveWorkspaceConfig;
  const identity = { userId: "user-c", workspaceId: "workspace-c" };
  let shouldFail = true;
  let serverSettings: WorkspaceConfigFile["storage"] = {
    ...DEFAULT_CANVAS_PREFERENCES,
  };

  platformBridge.loadWorkspaceConfig = async () => ({
    version: 1,
    storage: serverSettings,
  });
  platformBridge.saveWorkspaceConfig = async (patch) => {
    if (shouldFail) throw new Error("temporary settings failure");
    serverSettings = { ...serverSettings, ...patch };
    return { version: 1, storage: serverSettings };
  };

  try {
    useSettingsStore.getState().clearVaultSession();
    await useSettingsStore
      .getState()
      .hydrateFromWorkspace(identity.userId, identity.workspaceId);

    await assert.rejects(
      useSettingsStore
        .getState()
        .updateStorageSettings({ lowQualityPreviewEnabled: false }),
      /temporary settings failure/,
    );
    assert.equal(
      useSettingsStore.getState().config.storage.lowQualityPreviewEnabled,
      false,
    );
    assert.deepEqual(readWorkspaceConfigCache(identity)?.pendingPatch, {
      lowQualityPreviewEnabled: false,
    });

    shouldFail = false;
    useSettingsStore.getState().clearVaultSession();
    await useSettingsStore
      .getState()
      .hydrateFromWorkspace(identity.userId, identity.workspaceId);

    assert.equal(serverSettings.lowQualityPreviewEnabled, false);
    assert.equal(
      useSettingsStore.getState().config.storage.lowQualityPreviewEnabled,
      false,
    );
    assert.deepEqual(readWorkspaceConfigCache(identity)?.pendingPatch, {});
  } finally {
    platformBridge.loadWorkspaceConfig = originalLoad;
    platformBridge.saveWorkspaceConfig = originalSave;
    useSettingsStore.getState().clearVaultSession();
    local.restore();
  }
});
