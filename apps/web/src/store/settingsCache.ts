import { redactWorkspaceConfigSecretsForCache } from "../features/settings/providerSecrets.ts";
import type { WorkspaceConfigFile } from "../types/index.ts";

const WORKSPACE_CONFIG_CACHE_KEY = "ai-canvas-workspace-config-cache";
const DEVICE_ONLY_STORAGE_KEYS = [
  "ai-canvas-generation-mode",
  "ai-canvas-custom-task-cache",
] as const;

export function readWorkspaceConfigCache(): WorkspaceConfigFile | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_CONFIG_CACHE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as WorkspaceConfigFile;
  } catch {
    return null;
  }
}

export function writeWorkspaceConfigCache(config: WorkspaceConfigFile) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      WORKSPACE_CONFIG_CACHE_KEY,
      JSON.stringify(redactWorkspaceConfigSecretsForCache(config)),
    );
  } catch {
    // Ignore cache write failures; workspace persistence remains authoritative.
  }
}

export function clearLegacyPersistedConfig() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("ai-canvas-settings");
  } catch {
    // The in-memory Vault remains usable when localStorage is unavailable.
  }
}

export function clearDeviceOnlySettingsCache() {
  if (typeof window === "undefined") return;
  try {
    for (const key of DEVICE_ONLY_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Best effort only. IndexedDB deletion remains authoritative for credentials.
  }
}
