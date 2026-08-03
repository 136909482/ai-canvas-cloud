import { redactWorkspaceConfigSecretsForCache } from "../features/settings/providerSecrets.ts";
import type { WorkspaceConfigFile } from "../types/index.ts";

const LEGACY_WORKSPACE_CONFIG_CACHE_KEY = "ai-canvas-workspace-config-cache";
const WORKSPACE_CONFIG_CACHE_PREFIX = "ai-canvas-workspace-config-cache-v2";
const DEVICE_ONLY_STORAGE_KEYS = [
  "ai-canvas-generation-mode",
  "ai-canvas-custom-task-cache",
] as const;

export interface SettingsCacheIdentity {
  userId: string;
  workspaceId: string;
}

export type PendingWorkspaceSettingsPatch = Partial<
  WorkspaceConfigFile["storage"]
>;

export interface WorkspaceSettingsCacheEntry {
  version: 2;
  config: WorkspaceConfigFile;
  pendingPatch: PendingWorkspaceSettingsPatch;
}

function scopedCacheKey(identity: SettingsCacheIdentity) {
  return `${WORKSPACE_CONFIG_CACHE_PREFIX}:${encodeURIComponent(identity.userId)}:${encodeURIComponent(identity.workspaceId)}`;
}

function parseWorkspaceConfig(raw: string | null): WorkspaceConfigFile | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkspaceConfigFile;
    return parsed?.version === 1 && parsed.storage ? parsed : null;
  } catch {
    return null;
  }
}

export function readLegacyWorkspaceConfigCache(): WorkspaceConfigFile | null {
  if (typeof window === "undefined") return null;
  try {
    return parseWorkspaceConfig(
      window.localStorage.getItem(LEGACY_WORKSPACE_CONFIG_CACHE_KEY),
    );
  } catch {
    return null;
  }
}

export function removeLegacyWorkspaceConfigCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_WORKSPACE_CONFIG_CACHE_KEY);
  } catch {
    // Best effort after a successful cloud migration.
  }
}

export function readWorkspaceConfigCache(
  identity: SettingsCacheIdentity,
): WorkspaceSettingsCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(scopedCacheKey(identity));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceSettingsCacheEntry;
    if (
      parsed?.version !== 2 ||
      parsed.config?.version !== 1 ||
      !parsed.config.storage ||
      !parsed.pendingPatch ||
      typeof parsed.pendingPatch !== "object" ||
      Array.isArray(parsed.pendingPatch)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeWorkspaceConfigCache(
  identity: SettingsCacheIdentity,
  config: WorkspaceConfigFile,
  pendingPatch: PendingWorkspaceSettingsPatch = {},
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      scopedCacheKey(identity),
      JSON.stringify({
        version: 2,
        config: redactWorkspaceConfigSecretsForCache(config),
        pendingPatch,
      } satisfies WorkspaceSettingsCacheEntry),
    );
  } catch {
    // Cloud persistence remains authoritative when cache writes fail.
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
