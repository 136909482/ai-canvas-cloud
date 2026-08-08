import { normalizeLocalModelBindings } from "../features/settings/localModelReferences.ts";
import { normalizeStoredCustomImageProviderManifest } from "../features/settings/customImageProviderManifest.ts";
import { inferProviderFromApiUrl } from "../config/modelCatalog.ts";
import { DEFAULT_CANVAS_PREFERENCES } from "@ai-canvas-cloud/contracts/canvas-preferences";
import type {
  ApiConfig,
  CustomImageProviderManifestV1,
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
  };
}

export function normalizeModelEntry(entry: Partial<ModelEntry>): ModelEntry {
  return createModelEntry(entry);
}

export function createProviderProfile(
  overrides: Partial<ProviderProfileConfig> = {},
): ProviderProfileConfig {
  const now = Date.now();
  const baseUrl = overrides.baseUrl?.trim() ?? "";
  const protocol =
    overrides.protocol === "dashscope" ||
    overrides.protocol === "custom-http-image-v1"
      ? overrides.protocol
      : inferProviderFromApiUrl(baseUrl) === "aliyun"
        ? "dashscope"
        : "openai-compatible";
  // Standard protocols deliberately use one predictable configuration. The
  // advanced auth/mode fields remain part of the persisted type for custom
  // manifests and future re-opening, but are not user-configurable here.
  const authMode =
    protocol === "custom-http-image-v1"
      ? overrides.authMode === "none" ||
        overrides.authMode === "x-api-key" ||
        overrides.authMode === "api-key"
        ? overrides.authMode
        : "bearer"
      : "bearer";
  return {
    id: overrides.id?.trim() || createEntityId(),
    name: overrides.name?.trim() || "New Provider",
    protocol,
    authMode,
    ...(protocol === "custom-http-image-v1" &&
    overrides.customManifestId?.trim()
      ? { customManifestId: overrides.customManifestId.trim() }
      : {}),
    baseUrl,
    enabled: overrides.enabled ?? true,
    imageRequestMode:
      protocol === "custom-http-image-v1" &&
      overrides.imageRequestMode === "async"
        ? "async"
        : "sync",
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
  const autosaveIntervalMs =
    config?.autosaveIntervalMs === 15_000 ||
    config?.autosaveIntervalMs === 30_000 ||
    config?.autosaveIntervalMs === 60_000 ||
    config?.autosaveIntervalMs === 120_000 ||
    config?.autosaveIntervalMs === 300_000
      ? config.autosaveIntervalMs
      : DEFAULT_CANVAS_PREFERENCES.autosaveIntervalMs;
  const themeMode =
    config?.themeMode === "light" || config?.themeMode === "system"
      ? config.themeMode
      : DEFAULT_CANVAS_PREFERENCES.themeMode;
  const canvasPerformanceMode =
    config?.canvasPerformanceMode === "performance"
      ? "performance"
      : DEFAULT_CANVAS_PREFERENCES.canvasPerformanceMode;
  const legacyEdgeStyle = (config as { edgeStyle?: unknown } | undefined)
    ?.edgeStyle;
  const edgeStyle =
    config?.edgeStyle === "solid" ||
    config?.edgeStyle === "step" ||
    config?.edgeStyle === "smoothstep"
      ? config.edgeStyle
      : legacyEdgeStyle === "colorful"
        ? "step"
        : DEFAULT_CANVAS_PREFERENCES.edgeStyle;

  return {
    autosaveIntervalMs,
    canvasTopBarCollapsed: Boolean(config?.canvasTopBarCollapsed),
    alignmentGuidesEnabled: config?.alignmentGuidesEnabled !== false,
    incomingEdgeAnimationEnabled:
      config?.incomingEdgeAnimationEnabled !== false,
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

function normalizeLastUsedModelEntryIds(
  value: unknown,
  enabledEntries: ModelEntry[],
  defaultModelEntryId: string,
) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<Record<ModelCategory, unknown>>)
      : {};
  const result: Partial<Record<ModelCategory, string>> = {};

  for (const category of ["chat", "image", "video"] as const) {
    const modelEntryId = source[category];
    if (
      typeof modelEntryId === "string" &&
      enabledEntries.some(
        (entry) => entry.id === modelEntryId && entry.category === category,
      )
    ) {
      result[category] = modelEntryId;
    }
  }

  const defaultEntry = enabledEntries.find(
    (entry) => entry.id === defaultModelEntryId,
  );
  if (defaultEntry && !result[defaultEntry.category]) {
    result[defaultEntry.category] = defaultEntry.id;
  }

  return result;
}

export function normalizeConfig(config: ConfigInput = {}): ApiConfig {
  const customImageProviderManifests = Array.isArray(
    config.customImageProviderManifests,
  )
    ? config.customImageProviderManifests
        .map(normalizeStoredCustomImageProviderManifest)
        .filter(
          (manifest): manifest is CustomImageProviderManifestV1 =>
            manifest !== null,
        )
        .filter(
          (manifest, index, manifests) =>
            manifests.findIndex((candidate) => candidate.id === manifest.id) ===
            index,
        )
    : [];
  const providerProfiles = Array.isArray(config.providerProfiles)
    ? config.providerProfiles
        .map((profile) => normalizeProviderProfile(profile))
        .map((profile) => {
          if (profile.protocol !== "custom-http-image-v1") return profile;
          const manifest = customImageProviderManifests.find(
            (candidate) => candidate.id === profile.customManifestId,
          );
          return {
            ...profile,
            imageRequestMode:
              manifest?.executionMode === "polling"
                ? ("async" as const)
                : ("sync" as const),
          };
        })
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
  const lastUsedModelEntryIds = normalizeLastUsedModelEntryIds(
    config.lastUsedModelEntryIds,
    enabledEntries,
    defaultModelEntryId,
  );
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
    lastUsedModelEntryIds,
    modelEntries,
    providerProfiles,
    customImageProviderManifests,
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
      incomingEdgeAnimationEnabled: storage.incomingEdgeAnimationEnabled,
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
