import { normalizeLocalModelBindings } from "../features/settings/localModelReferences.ts";
import type {
  ApiConfig,
  ModelCategory,
  ModelEntry,
  ModelEntryStatus,
  ModelSource,
  ProviderProfileConfig,
  StorageConfig,
  WorkspaceConfigFile,
} from "../types/index.ts";

function createEntityId() {
  return crypto.randomUUID();
}

function normalizeCategory(value: unknown): ModelCategory {
  return value === "chat" || value === "video" ? value : "image";
}

function normalizeSource(value: unknown): ModelSource {
  return value === "discovered" ? "discovered" : "manual";
}

function normalizeStatus(
  value: unknown,
  providerProfileId: string | null,
): ModelEntryStatus {
  if (!providerProfileId) return "unbound";
  return value === "missing" ? "missing" : "available";
}

function normalizeTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createModelEntry(
  overrides: Partial<ModelEntry> = {},
): ModelEntry {
  const now = Date.now();
  const providerProfileId = overrides.providerProfileId?.trim() || null;
  const modelId = overrides.modelId?.trim() ?? "";
  const status = normalizeStatus(overrides.status, providerProfileId);

  return {
    id: overrides.id?.trim() || createEntityId(),
    providerProfileId,
    modelId,
    displayName: overrides.displayName?.trim() || modelId,
    category: normalizeCategory(overrides.category),
    source: normalizeSource(overrides.source),
    status,
    enabled: overrides.enabled ?? true,
    createdAt: normalizeTimestamp(overrides.createdAt, now),
    updatedAt: normalizeTimestamp(overrides.updatedAt, now),
    ...(typeof overrides.lastSeenAt === "number" &&
    Number.isFinite(overrides.lastSeenAt)
      ? { lastSeenAt: overrides.lastSeenAt }
      : {}),
    ...(overrides.legacyLabel?.trim()
      ? { legacyLabel: overrides.legacyLabel.trim() }
      : {}),
  };
}

export function normalizeModelEntry(entry: Partial<ModelEntry>): ModelEntry {
  return createModelEntry(entry);
}

export function createProviderProfile(
  overrides: Partial<ProviderProfileConfig> = {},
): ProviderProfileConfig {
  const now = Date.now();
  return {
    id: overrides.id?.trim() || createEntityId(),
    name: overrides.name?.trim() || "New Provider",
    protocol: "openai-compatible",
    baseUrl: overrides.baseUrl?.trim() ?? "",
    enabled: overrides.enabled ?? true,
    imageRequestMode: overrides.imageRequestMode === "async" ? "async" : "sync",
    createdAt: normalizeTimestamp(overrides.createdAt, now),
    updatedAt: normalizeTimestamp(overrides.updatedAt, now),
    ...(typeof overrides.lastDiscoveryAt === "number" &&
    Number.isFinite(overrides.lastDiscoveryAt)
      ? { lastDiscoveryAt: overrides.lastDiscoveryAt }
      : {}),
  };
}

export function normalizeProviderProfile(
  profile: Partial<ProviderProfileConfig>,
): ProviderProfileConfig {
  return createProviderProfile(profile);
}

function normalizeApiKeys(value: unknown, profiles: ProviderProfileConfig[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const profileIds = new Set(profiles.map((profile) => profile.id));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string] =>
          profileIds.has(entry[0]) &&
          typeof entry[1] === "string" &&
          entry[1].trim().length > 0,
      )
      .map(([profileId, apiKey]) => [profileId, apiKey.trim()]),
  );
}

export function normalizeStorageConfig(
  config?: Partial<StorageConfig>,
): StorageConfig {
  const autosaveIntervalMs = Number.isFinite(config?.autosaveIntervalMs)
    ? Math.max(15_000, Number(config?.autosaveIntervalMs))
    : 60_000;
  const themeMode =
    config?.themeMode === "light" || config?.themeMode === "system"
      ? config.themeMode
      : "dark";
  const canvasPerformanceMode =
    config?.canvasPerformanceMode === "performance" ? "performance" : "quality";
  const edgeStyle =
    config?.edgeStyle === "solid" ||
    config?.edgeStyle === "step" ||
    config?.edgeStyle === "smoothstep"
      ? config.edgeStyle
      : config?.edgeStyle === "colorful"
        ? "step"
        : "animated";

  return {
    autosaveIntervalMs,
    canvasTopBarCollapsed: Boolean(config?.canvasTopBarCollapsed),
    alignmentGuidesEnabled: config?.alignmentGuidesEnabled !== false,
    themeMode,
    canvasPerformanceMode,
    canvasGridEnabled: config?.canvasGridEnabled !== false,
    edgeStyle,
    lowQualityPreviewEnabled: config?.lowQualityPreviewEnabled !== false,
    workspaceDirectoryName: config?.workspaceDirectoryName?.trim() ?? "",
    workspaceConfigured: Boolean(config?.workspaceConfigured),
  };
}

type ConfigInput = Omit<Partial<ApiConfig>, "storage"> & {
  storage?: Partial<StorageConfig>;
};

export function normalizeConfig(config: ConfigInput = {}): ApiConfig {
  const providerProfiles = Array.isArray(config.providerProfiles)
    ? config.providerProfiles.map((profile) =>
        normalizeProviderProfile(profile),
      )
    : [];
  const profileIds = new Set(providerProfiles.map((profile) => profile.id));
  const modelEntries = Array.isArray(config.modelEntries)
    ? config.modelEntries.map((entry) => {
        const normalized = normalizeModelEntry(entry);
        return normalized.providerProfileId &&
          !profileIds.has(normalized.providerProfileId)
          ? {
              ...normalized,
              providerProfileId: null,
              status: "unbound" as const,
            }
          : normalized;
      })
    : [];
  const enabledEntries = modelEntries.filter(
    (entry) => entry.enabled && entry.status === "available",
  );
  const defaultModelEntryId =
    typeof config.defaultModelEntryId === "string" &&
    enabledEntries.some((entry) => entry.id === config.defaultModelEntryId)
      ? config.defaultModelEntryId
      : "";
  const providerApiKeys = normalizeApiKeys(
    config.providerApiKeys,
    providerProfiles,
  );
  // Keep a deleted entry's anonymous reference so existing nodes can show a
  // recoverable "deleted" state instead of silently becoming unbound.
  const localModelBindings = normalizeLocalModelBindings(
    config.localModelBindings,
  );

  return {
    defaultModelEntryId,
    modelEntries,
    providerProfiles,
    providerApiKeys,
    localModelBindings,
    storage: normalizeStorageConfig(config.storage),
  };
}

export function toWorkspaceConfigFile(config: ApiConfig): WorkspaceConfigFile {
  const storage = normalizeStorageConfig(config.storage);
  return {
    version: 1,
    storage: {
      autosaveIntervalMs: storage.autosaveIntervalMs,
      canvasTopBarCollapsed: storage.canvasTopBarCollapsed,
      alignmentGuidesEnabled: storage.alignmentGuidesEnabled,
      themeMode: storage.themeMode,
      canvasPerformanceMode: storage.canvasPerformanceMode,
      canvasGridEnabled: storage.canvasGridEnabled,
      edgeStyle: storage.edgeStyle,
      lowQualityPreviewEnabled: storage.lowQualityPreviewEnabled,
    },
  };
}

export function fromWorkspaceConfigFile(
  config: WorkspaceConfigFile | null | undefined,
): ApiConfig | null {
  if (!config || config.version !== 1) return null;
  return normalizeConfig({ storage: { ...config.storage } });
}
