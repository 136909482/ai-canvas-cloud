import { create } from "zustand";
import { reportDiagnostic } from "./useDiagnosticsStore.ts";
import { platformBridge } from "../platform/index.ts";
import {
  LOCAL_VAULT_SCHEMA_VERSION,
  LOCAL_TASK_CACHE_SCHEMA_VERSION,
  deleteRememberedLocalTaskQueue,
  isLocalVaultSupported,
  loadRememberedLocalTaskQueue,
  loadRememberedLocalVault,
  saveRememberedLocalTaskQueue,
  saveRememberedLocalVault,
  type LocalVaultDocument,
  type LocalVaultPersistence,
} from "../features/settings/localVault.ts";
import { useTaskQueueStore } from "./useTaskQueueStore.ts";
import {
  createLocalModelReference,
  findLocalModelReference,
  isLocalModelReference,
  resolveLocalModelReference,
} from "../features/settings/localModelReferences.ts";
import {
  reconcileDiscoveredModels,
  type ProviderModelImportSelection,
} from "../features/settings/providerModelDiscovery.ts";
import type {
  WorkspacePermissionState,
  WorkspaceStatus,
} from "../platform/types.ts";
import type {
  ApiConfig,
  CustomImageProviderManifestV1,
  ModelCategory,
  ModelEntry,
  ProviderProfileConfig,
  RuntimeModelConfig,
  StorageConfig,
  TaskQueueSnapshot,
} from "../types/index.ts";
import {
  readLegacyWorkspaceConfigCache,
  readWorkspaceConfigCache,
  removeLegacyWorkspaceConfigCache,
  writeWorkspaceConfigCache,
  type PendingWorkspaceSettingsPatch,
  type SettingsCacheIdentity,
} from "./settingsCache";
import {
  fromWorkspaceConfigFile,
  normalizeModelEntry,
  normalizeConfig,
  normalizeProviderProfile,
  toWorkspaceConfigFile,
} from "./settingsConfig";

export type LocalVaultStatus = "idle" | "loading" | "ready" | "error";

export interface SettingsRuntimeState {
  workspaceConfigured: boolean;
  workspaceDirectoryName: string;
  workspacePermission: WorkspacePermissionState;
  hydrated: boolean;
  lastLoadError: string | null;
  lastSaveError: string | null;
  settingsUserId: string | null;
  settingsWorkspaceId: string | null;
  vaultStatus: LocalVaultStatus;
  vaultPersistence: LocalVaultPersistence;
  vaultUserId: string | null;
  vaultUpdatedAt: number | null;
  vaultError: string | null;
}

export interface ProviderDiscoveryImport {
  profile: ProviderProfileConfig;
  apiKey: string;
  discoveredModelIds: readonly string[];
  selectedModels: readonly ProviderModelImportSelection[];
  discoveredAt?: number;
}

interface SettingsStore {
  config: ApiConfig;
  runtime: SettingsRuntimeState;
  setStorageSettings: (patch: Partial<StorageConfig>) => void;
  updateStorageSettings: (patch: Partial<StorageConfig>) => Promise<void>;
  setWorkspaceRuntimeStatus: (
    status: Pick<
      WorkspaceStatus,
      "configured" | "directoryName" | "permission"
    >,
  ) => void;
  hydrateFromWorkspace: (
    userId: string,
    workspaceId: string,
  ) => Promise<"workspace" | "default">;
  persistWorkspaceConfig: (
    patch?: PendingWorkspaceSettingsPatch,
  ) => Promise<void>;
  hydrateLocalVault: (
    userId: string,
  ) => Promise<"device" | "empty" | "session">;
  persistLocalVault: () => Promise<void>;
  loadLocalTaskQueue: (projectId: string) => Promise<TaskQueueSnapshot | null>;
  persistLocalTaskQueue: (
    projectId: string,
    taskQueue: TaskQueueSnapshot,
  ) => Promise<void>;
  deleteLocalTaskQueue: (projectId: string) => Promise<void>;
  clearVaultSession: () => void;
  setDefaultModel: (modelEntryId: string) => void;
  saveCustomModel: (model: ModelEntry) => void;
  deleteCustomModel: (id: string) => void;
  saveProviderProfile: (
    profile: ProviderProfileConfig,
    apiKey?: string,
  ) => void;
  saveCustomImageProviderManifest: (
    manifest: CustomImageProviderManifestV1,
  ) => void;
  deleteCustomImageProviderManifest: (id: string) => void;
  saveProviderDiscoveryImport: (
    input: ProviderDiscoveryImport,
  ) => Promise<void>;
  deleteProviderProfile: (id: string) => void;
  setProviderApiKey: (profileId: string, apiKey: string) => void;
  setModelProviderProfile: (
    modelEntryId: string,
    profileId: string | null,
  ) => void;
  ensureLocalModelReference: (modelEntryId: string) => string;
  bindLocalModelReference: (reference: string, modelEntryId: string) => boolean;
  resolveLocalModelReference: (reference: string) => string | null;
  getCustomModels: () => ModelEntry[];
  getEnabledCustomModels: (category?: ModelCategory) => ModelEntry[];
  getProviderProfiles: () => ProviderProfileConfig[];
  getModelConfig: (
    modelEntryId?: string,
    category?: ModelCategory,
  ) => RuntimeModelConfig | undefined;
}

function createDefaultRuntimeState(): SettingsRuntimeState {
  return {
    workspaceConfigured: false,
    workspaceDirectoryName: "",
    workspacePermission: "prompt",
    hydrated: false,
    lastLoadError: null,
    lastSaveError: null,
    settingsUserId: null,
    settingsWorkspaceId: null,
    vaultStatus: "idle",
    vaultPersistence: "device",
    vaultUserId: null,
    vaultUpdatedAt: null,
    vaultError: null,
  };
}

function withoutPrivateSettings(config: ApiConfig): ApiConfig {
  return normalizeConfig({
    defaultModelEntryId: "",
    lastUsedModelEntryIds: {},
    modelEntries: [],
    providerProfiles: [],
    customImageProviderManifests: [],
    providerApiKeys: {},
    localModelBindings: {},
    storage: config.storage,
  });
}

function mergeLocalVaultDocument(
  config: ApiConfig,
  document: LocalVaultDocument,
): ApiConfig {
  return normalizeConfig({
    defaultModelEntryId: document.defaultModelEntryId,
    lastUsedModelEntryIds: document.lastUsedModelEntryIds,
    modelEntries: document.modelEntries,
    providerProfiles: document.providerProfiles,
    customImageProviderManifests: document.customImageProviderManifests,
    providerApiKeys: document.providerApiKeys,
    localModelBindings: document.localModelBindings,
    storage: config.storage,
  });
}

function createLocalVaultDocument(
  config: ApiConfig,
  userId: string,
  updatedAt = Date.now(),
): LocalVaultDocument {
  const normalized = normalizeConfig(config);
  return {
    schemaVersion: LOCAL_VAULT_SCHEMA_VERSION,
    userId,
    defaultModelEntryId: normalized.defaultModelEntryId,
    lastUsedModelEntryIds: normalized.lastUsedModelEntryIds,
    modelEntries: normalized.modelEntries,
    providerProfiles: normalized.providerProfiles,
    customImageProviderManifests: normalized.customImageProviderManifests,
    providerApiKeys: normalized.providerApiKeys,
    localModelBindings: normalized.localModelBindings,
    updatedAt,
  };
}

interface LocalVaultRuntimeContext {
  userId: string | null;
  persistence: LocalVaultPersistence;
  stateVersion: number;
}

let localVaultOperationChain = Promise.resolve();
let workspaceConfigOperationChain = Promise.resolve();
let localVaultStateVersion = 0;
const sessionTaskQueues = new Map<string, TaskQueueSnapshot>();

function getSessionTaskQueueKey(userId: string, projectId: string) {
  return `${userId}\n${projectId}`;
}

function cloneTaskQueue(taskQueue: TaskQueueSnapshot) {
  return structuredClone(taskQueue);
}

function clearSessionTaskQueues(userId?: string | null) {
  if (!userId) {
    sessionTaskQueues.clear();
    return;
  }

  const prefix = `${userId}\n`;
  for (const key of sessionTaskQueues.keys()) {
    if (key.startsWith(prefix)) sessionTaskQueues.delete(key);
  }
}

function advanceLocalVaultStateVersion() {
  localVaultStateVersion += 1;
  return localVaultStateVersion;
}

function enqueueLocalVaultOperation<T>(operation: () => Promise<T>) {
  const result = localVaultOperationChain.then(operation);
  localVaultOperationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function enqueueWorkspaceConfigOperation<T>(operation: () => Promise<T>) {
  const result = workspaceConfigOperationChain.then(operation);
  workspaceConfigOperationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function settingsIdentity(
  runtime: SettingsRuntimeState,
): SettingsCacheIdentity | null {
  return runtime.settingsUserId && runtime.settingsWorkspaceId
    ? {
        userId: runtime.settingsUserId,
        workspaceId: runtime.settingsWorkspaceId,
      }
    : null;
}

function hasSettingsPatch(patch: PendingWorkspaceSettingsPatch) {
  return Object.keys(patch).length > 0;
}

function remainingPendingPatch(
  current: PendingWorkspaceSettingsPatch,
  sent: PendingWorkspaceSettingsPatch,
) {
  return Object.fromEntries(
    Object.entries(current).filter(
      ([key, value]) =>
        !(key in sent) || sent[key as keyof typeof sent] !== value,
    ),
  ) as PendingWorkspaceSettingsPatch;
}

function isCurrentLocalVaultContext(
  runtime: SettingsRuntimeState,
  context: LocalVaultRuntimeContext,
) {
  return (
    localVaultStateVersion === context.stateVersion &&
    runtime.vaultUserId === context.userId &&
    runtime.vaultPersistence === context.persistence
  );
}

function normalizeWorkspaceRuntimeStatus(
  status: Pick<WorkspaceStatus, "configured" | "directoryName" | "permission">,
) {
  return {
    workspaceConfigured: status.configured && status.permission !== "denied",
    workspaceDirectoryName:
      status.permission === "denied" ? "" : status.directoryName,
    workspacePermission: status.permission,
  };
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  config: normalizeConfig(),
  runtime: createDefaultRuntimeState(),

  setStorageSettings: (patch) =>
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        storage: {
          ...state.config.storage,
          ...patch,
          workspaceConfigured: state.config.storage.workspaceConfigured,
          workspaceDirectoryName: state.config.storage.workspaceDirectoryName,
        },
      }),
    })),

  updateStorageSettings: async (patch) => {
    get().setStorageSettings(patch);
    const workspacePatch = Object.fromEntries(
      Object.entries(patch).filter(
        ([key]) =>
          key !== "workspaceConfigured" && key !== "workspaceDirectoryName",
      ),
    ) as PendingWorkspaceSettingsPatch;
    if (hasSettingsPatch(workspacePatch)) {
      await get().persistWorkspaceConfig(workspacePatch);
    }
  },

  setWorkspaceRuntimeStatus: (status) =>
    set((state) => ({
      config: {
        ...state.config,
        storage: {
          ...state.config.storage,
          ...normalizeWorkspaceRuntimeStatus(status),
        },
      },
      runtime: {
        ...state.runtime,
        ...normalizeWorkspaceRuntimeStatus(status),
      },
    })),

  hydrateFromWorkspace: async (userId, workspaceId) => {
    const identity = {
      userId: userId.trim(),
      workspaceId: workspaceId.trim(),
    };
    const cached = readWorkspaceConfigCache(identity);
    const legacy = readLegacyWorkspaceConfigCache();

    set((state) => ({
      runtime: {
        ...state.runtime,
        settingsUserId: identity.userId,
        settingsWorkspaceId: identity.workspaceId,
      },
    }));

    const applyHydratedConfig = (
      workspaceConfig: ReturnType<typeof toWorkspaceConfigFile>,
      options: { loadError?: string | null; saveError?: string | null } = {},
    ) => {
      const hydratedConfig =
        fromWorkspaceConfigFile(workspaceConfig) ?? normalizeConfig();
      set((state) => ({
        config: {
          ...state.config,
          storage: {
            ...hydratedConfig.storage,
            workspaceConfigured: state.runtime.workspaceConfigured,
            workspaceDirectoryName: state.runtime.workspaceDirectoryName,
          },
        },
        runtime: {
          ...state.runtime,
          hydrated: true,
          lastLoadError: options.loadError ?? null,
          lastSaveError: options.saveError ?? null,
        },
      }));
    };

    try {
      const cloudConfig = await platformBridge.loadWorkspaceConfig();

      if (cloudConfig) {
        const pendingPatch = cached?.pendingPatch ?? {};
        if (hasSettingsPatch(pendingPatch)) {
          const pendingConfig = {
            version: 1 as const,
            storage: { ...cloudConfig.storage, ...pendingPatch },
          };
          try {
            const savedConfig =
              await platformBridge.saveWorkspaceConfig(pendingPatch);
            writeWorkspaceConfigCache(identity, savedConfig);
            removeLegacyWorkspaceConfigCache();
            applyHydratedConfig(savedConfig);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            writeWorkspaceConfigCache(identity, pendingConfig, pendingPatch);
            applyHydratedConfig(pendingConfig, { saveError: message });
            reportDiagnostic({
              area: "persistence",
              title: "云同步失败，将稍后重试",
              error,
              code: "WORKSPACE_CONFIG_SAVE_FAILED",
              context: { operation: "retry-settings" },
            });
          }
        } else {
          writeWorkspaceConfigCache(identity, cloudConfig);
          removeLegacyWorkspaceConfigCache();
          applyHydratedConfig(cloudConfig);
        }
        return "workspace" as const;
      }

      const seedConfig = toWorkspaceConfigFile(
        fromWorkspaceConfigFile(legacy ?? cached?.config) ?? normalizeConfig(),
      );
      try {
        const savedConfig = await platformBridge.saveWorkspaceConfig(
          seedConfig.storage,
        );
        writeWorkspaceConfigCache(identity, savedConfig);
        removeLegacyWorkspaceConfigCache();
        applyHydratedConfig(savedConfig);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeWorkspaceConfigCache(identity, seedConfig, seedConfig.storage);
        applyHydratedConfig(seedConfig, { saveError: message });
        reportDiagnostic({
          area: "persistence",
          title: "云同步失败，将稍后重试",
          error,
          code: "WORKSPACE_CONFIG_SAVE_FAILED",
          context: { operation: "initialize-settings" },
        });
      }
      return "default" as const;
    } catch (error) {
      const fallback = toWorkspaceConfigFile(
        fromWorkspaceConfigFile(cached?.config ?? legacy) ?? normalizeConfig(),
      );
      writeWorkspaceConfigCache(identity, fallback, cached?.pendingPatch ?? {});
      applyHydratedConfig(fallback, {
        loadError: error instanceof Error ? error.message : String(error),
      });
      return "default" as const;
    }
  },

  persistWorkspaceConfig: async (patch) => {
    const state = get();
    const identity = settingsIdentity(state.runtime);
    if (!identity) return;

    const workspaceConfig = toWorkspaceConfigFile(state.config);
    const cached = readWorkspaceConfigCache(identity);
    const pendingPatch = {
      ...cached?.pendingPatch,
      ...(patch ?? workspaceConfig.storage),
    };
    writeWorkspaceConfigCache(identity, workspaceConfig, pendingPatch);

    await enqueueWorkspaceConfigOperation(async () => {
      const latest = readWorkspaceConfigCache(identity);
      const sentPatch = latest?.pendingPatch ?? pendingPatch;
      if (!hasSettingsPatch(sentPatch)) return;

      try {
        const savedConfig = await platformBridge.saveWorkspaceConfig(sentPatch);
        const afterSave = readWorkspaceConfigCache(identity);
        const remaining = remainingPendingPatch(
          afterSave?.pendingPatch ?? {},
          sentPatch,
        );
        const effectiveConfig = {
          version: 1 as const,
          storage: { ...savedConfig.storage, ...remaining },
        };
        writeWorkspaceConfigCache(identity, effectiveConfig, remaining);
        removeLegacyWorkspaceConfigCache();
        set((current) => {
          const currentIdentity = settingsIdentity(current.runtime);
          if (
            currentIdentity?.userId !== identity.userId ||
            currentIdentity.workspaceId !== identity.workspaceId
          ) {
            return current;
          }
          return {
            config: normalizeConfig({
              ...current.config,
              storage: {
                ...effectiveConfig.storage,
                workspaceConfigured: current.runtime.workspaceConfigured,
                workspaceDirectoryName: current.runtime.workspaceDirectoryName,
              },
            }),
            runtime: { ...current.runtime, lastSaveError: null },
          };
        });
      } catch (error) {
        reportDiagnostic({
          area: "persistence",
          title: "云同步失败，将稍后重试",
          error,
          code: "WORKSPACE_CONFIG_SAVE_FAILED",
          context: { operation: "save-settings" },
        });
        set((current) => ({
          runtime: {
            ...current.runtime,
            lastSaveError:
              error instanceof Error ? error.message : String(error),
          },
        }));
        throw error;
      }
    });
  },

  hydrateLocalVault: async (userId) => {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      get().clearVaultSession();
      return "session";
    }

    const vaultSupported = isLocalVaultSupported();
    const persistence: LocalVaultPersistence = vaultSupported
      ? "device"
      : "session";
    const stateVersion = advanceLocalVaultStateVersion();
    const context: LocalVaultRuntimeContext = {
      userId: normalizedUserId,
      persistence,
      stateVersion,
    };

    set((state) => ({
      config: withoutPrivateSettings(state.config),
      runtime: {
        ...state.runtime,
        vaultStatus: "loading",
        vaultPersistence: persistence,
        vaultUserId: normalizedUserId,
        vaultUpdatedAt: null,
        vaultError: null,
      },
    }));

    try {
      if (vaultSupported) {
        const remembered = await loadRememberedLocalVault(normalizedUserId);
        if (!isCurrentLocalVaultContext(get().runtime, context))
          return "session";

        if (remembered) {
          set((state) => ({
            config: mergeLocalVaultDocument(state.config, remembered),
            runtime: {
              ...state.runtime,
              vaultStatus: "ready",
              vaultPersistence: "device",
              vaultUserId: normalizedUserId,
              vaultUpdatedAt: remembered.updatedAt,
              vaultError: null,
            },
          }));
          return "device";
        }
      }

      if (vaultSupported) {
        await get().persistLocalVault();
        return isCurrentLocalVaultContext(get().runtime, context)
          ? "empty"
          : "session";
      }

      if (!isCurrentLocalVaultContext(get().runtime, context)) return "session";
      set((state) => ({
        runtime: {
          ...state.runtime,
          vaultStatus: "error",
          vaultPersistence: "session",
          vaultUserId: normalizedUserId,
          vaultUpdatedAt: null,
          vaultError: "当前浏览器不支持加密设备存储，无法保存本地 Vault。",
        },
      }));
      return "session";
    } catch (error) {
      if (!isCurrentLocalVaultContext(get().runtime, context)) return "session";

      const message = error instanceof Error ? error.message : String(error);
      advanceLocalVaultStateVersion();
      set((state) => ({
        config: withoutPrivateSettings(state.config),
        runtime: {
          ...state.runtime,
          vaultStatus: "error",
          vaultPersistence: "session",
          vaultUserId: normalizedUserId,
          vaultUpdatedAt: null,
          vaultError: message,
        },
      }));
      return "session";
    }
  },

  persistLocalVault: async () => {
    let state = get();
    const userId = state.runtime.vaultUserId;

    if (!userId) return;

    if (!isLocalVaultSupported()) {
      throw new Error("当前浏览器不支持加密设备存储。");
    }

    if (state.runtime.vaultPersistence !== "device") {
      advanceLocalVaultStateVersion();
      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultPersistence: "device",
          vaultStatus: "ready",
          vaultError: null,
        },
      }));
      state = get();
    }

    const document = createLocalVaultDocument(state.config, userId);
    const context: LocalVaultRuntimeContext = {
      userId,
      persistence: "device",
      stateVersion: localVaultStateVersion,
    };
    const write = enqueueLocalVaultOperation(() =>
      saveRememberedLocalVault(document),
    );

    try {
      await write;
      if (!isCurrentLocalVaultContext(get().runtime, context)) return;

      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultStatus: "ready",
          vaultUpdatedAt: document.updatedAt,
          vaultError: null,
        },
      }));
    } catch (error) {
      if (!isCurrentLocalVaultContext(get().runtime, context)) throw error;

      const message = error instanceof Error ? error.message : String(error);
      set((current) => ({
        runtime: {
          ...current.runtime,
          vaultStatus: "error",
          vaultError: message,
        },
      }));
      throw error;
    }
  },

  loadLocalTaskQueue: async (projectId) => {
    const normalizedProjectId = projectId.trim();
    const state = get();
    const userId = state.runtime.vaultUserId;
    if (!normalizedProjectId || !userId) return null;

    const sessionSnapshot = sessionTaskQueues.get(
      getSessionTaskQueueKey(userId, normalizedProjectId),
    );
    if (sessionSnapshot) return cloneTaskQueue(sessionSnapshot);
    if (state.runtime.vaultPersistence !== "device" || !isLocalVaultSupported())
      return null;

    const context: LocalVaultRuntimeContext = {
      userId,
      persistence: "device",
      stateVersion: localVaultStateVersion,
    };
    const document = await enqueueLocalVaultOperation(() =>
      loadRememberedLocalTaskQueue(userId, normalizedProjectId),
    );
    if (!isCurrentLocalVaultContext(get().runtime, context)) return null;
    if (!document) return null;
    sessionTaskQueues.set(
      getSessionTaskQueueKey(userId, normalizedProjectId),
      cloneTaskQueue(document.taskQueue),
    );
    return cloneTaskQueue(document.taskQueue);
  },

  persistLocalTaskQueue: async (projectId, taskQueue) => {
    const normalizedProjectId = projectId.trim();
    const state = get();
    const userId = state.runtime.vaultUserId;

    if (!normalizedProjectId || !userId) return;

    const taskQueueSnapshot = cloneTaskQueue(taskQueue);
    sessionTaskQueues.set(
      getSessionTaskQueueKey(userId, normalizedProjectId),
      taskQueueSnapshot,
    );
    if (state.runtime.vaultPersistence !== "device" || !isLocalVaultSupported())
      return;

    const context: LocalVaultRuntimeContext = {
      userId,
      persistence: "device",
      stateVersion: localVaultStateVersion,
    };
    await enqueueLocalVaultOperation(() =>
      saveRememberedLocalTaskQueue({
        schemaVersion: LOCAL_TASK_CACHE_SCHEMA_VERSION,
        userId,
        projectId: normalizedProjectId,
        taskQueue: taskQueueSnapshot,
        updatedAt: Date.now(),
      }),
    );
    if (!isCurrentLocalVaultContext(get().runtime, context)) return;
  },

  deleteLocalTaskQueue: async (projectId) => {
    const normalizedProjectId = projectId.trim();
    const state = get();
    const userId = state.runtime.vaultUserId;

    if (!normalizedProjectId || !userId) return;

    sessionTaskQueues.delete(
      getSessionTaskQueueKey(userId, normalizedProjectId),
    );
    if (state.runtime.vaultPersistence !== "device" || !isLocalVaultSupported())
      return;

    const context: LocalVaultRuntimeContext = {
      userId,
      persistence: "device",
      stateVersion: localVaultStateVersion,
    };
    await enqueueLocalVaultOperation(() =>
      deleteRememberedLocalTaskQueue(userId, normalizedProjectId),
    );
    if (!isCurrentLocalVaultContext(get().runtime, context)) return;
  },

  clearVaultSession: () => {
    advanceLocalVaultStateVersion();
    clearSessionTaskQueues();
    useTaskQueueStore.getState().clearDeviceCache();
    set({
      config: normalizeConfig(),
      runtime: createDefaultRuntimeState(),
    });
  },

  setDefaultModel: (modelId) => {
    set((state) => {
      const model = state.config.modelEntries.find(
        (entry) => entry.id === modelId,
      );
      return {
        config: normalizeConfig({
          ...state.config,
          defaultModelEntryId: modelId,
          lastUsedModelEntryIds: model
            ? {
                ...state.config.lastUsedModelEntryIds,
                [model.category]: modelId,
              }
            : state.config.lastUsedModelEntryIds,
        }),
      };
    });
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  saveCustomModel: (model) => {
    set((state) => {
      const normalized = normalizeConfig(state.config);
      const previous = normalized.modelEntries.find(
        (item) => item.id === model.id,
      );
      const nextModel = normalizeModelEntry({
        ...model,
        createdAt: previous?.createdAt ?? model.createdAt,
        updatedAt: Date.now(),
      });
      const modelEntries = previous
        ? normalized.modelEntries.map((item) =>
            item.id === nextModel.id ? nextModel : item,
          )
        : [...normalized.modelEntries, nextModel];

      return {
        config: normalizeConfig({
          ...normalized,
          modelEntries,
          defaultModelEntryId:
            normalized.defaultModelEntryId ||
            (nextModel.enabled && nextModel.status === "available"
              ? nextModel.id
              : ""),
        }),
      };
    });
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  deleteCustomModel: (id) => {
    set((state) => {
      const normalized = normalizeConfig(state.config);
      const modelEntries = normalized.modelEntries.filter(
        (model) => model.id !== id,
      );

      return {
        config: normalizeConfig({
          ...normalized,
          modelEntries,
        }),
      };
    });
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  saveProviderProfile: (profile, apiKey) => {
    set((state) => {
      const normalized = normalizeConfig(state.config);
      const previous = normalized.providerProfiles.find(
        (item) => item.id === profile.id,
      );
      const nextProfile = normalizeProviderProfile({
        ...profile,
        // Provider protocol is selected at creation time and remains stable
        // for the lifetime of the profile. Re-adding is required to switch.
        ...(previous ? { protocol: previous.protocol } : {}),
        createdAt: previous?.createdAt ?? profile.createdAt,
        updatedAt: Date.now(),
      });
      const existingIndex = normalized.providerProfiles.findIndex(
        (item) => item.id === nextProfile.id,
      );
      const providerProfiles =
        existingIndex >= 0
          ? normalized.providerProfiles.map((item, index) =>
              index === existingIndex ? nextProfile : item,
            )
          : [...normalized.providerProfiles, nextProfile];
      const providerApiKeys =
        apiKey === undefined
          ? normalized.providerApiKeys
          : {
              ...normalized.providerApiKeys,
              ...(apiKey.trim() ? { [nextProfile.id]: apiKey.trim() } : {}),
            };

      if (apiKey !== undefined && !apiKey.trim())
        delete providerApiKeys[nextProfile.id];

      return {
        config: normalizeConfig({
          ...normalized,
          providerProfiles,
          providerApiKeys,
        }),
      };
    });
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  saveCustomImageProviderManifest: (manifest) => {
    set((state) => {
      const normalized = normalizeConfig(state.config);
      const existingIndex = normalized.customImageProviderManifests.findIndex(
        (candidate) => candidate.id === manifest.id,
      );
      const nextManifest = {
        ...manifest,
        createdAt:
          existingIndex >= 0
            ? normalized.customImageProviderManifests[existingIndex].createdAt
            : manifest.createdAt,
        updatedAt: Date.now(),
      };
      return {
        config: normalizeConfig({
          ...normalized,
          customImageProviderManifests:
            existingIndex >= 0
              ? normalized.customImageProviderManifests.map(
                  (candidate, index) =>
                    index === existingIndex ? nextManifest : candidate,
                )
              : [...normalized.customImageProviderManifests, nextManifest],
        }),
      };
    });
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  deleteCustomImageProviderManifest: (id) => {
    set((state) => {
      const normalized = normalizeConfig(state.config);
      if (
        normalized.providerProfiles.some(
          (profile) => profile.customManifestId === id,
        )
      ) {
        return state;
      }
      return {
        config: normalizeConfig({
          ...normalized,
          customImageProviderManifests:
            normalized.customImageProviderManifests.filter(
              (manifest) => manifest.id !== id,
            ),
        }),
      };
    });
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  saveProviderDiscoveryImport: async (input) => {
    const discoveredAt = input.discoveredAt ?? Date.now();
    const profileId = input.profile.id.trim();
    if (!profileId) return;

    set((state) => {
      const normalized = normalizeConfig(state.config);
      const previous = normalized.providerProfiles.find(
        (profile) => profile.id === profileId,
      );
      const profile = normalizeProviderProfile({
        ...input.profile,
        id: profileId,
        createdAt: previous?.createdAt ?? input.profile.createdAt,
        updatedAt: discoveredAt,
        lastDiscoveryAt: discoveredAt,
      });
      const providerProfiles = previous
        ? normalized.providerProfiles.map((candidate) =>
            candidate.id === profile.id ? profile : candidate,
          )
        : [...normalized.providerProfiles, profile];
      const providerApiKeys = {
        ...normalized.providerApiKeys,
        ...(input.apiKey.trim() ? { [profile.id]: input.apiKey.trim() } : {}),
      };
      if (!input.apiKey.trim()) delete providerApiKeys[profile.id];

      return {
        config: normalizeConfig({
          ...normalized,
          providerProfiles,
          providerApiKeys,
          modelEntries: reconcileDiscoveredModels({
            providerProfileId: profile.id,
            existingEntries: normalized.modelEntries,
            discoveredModelIds: input.discoveredModelIds,
            selectedModels: input.selectedModels,
            discoveredAt,
          }),
        }),
      };
    });

    // The provider, its credential slot, and all reconciled entries share one
    // in-memory state transition before this single encrypted document write.
    await get().persistLocalVault();
  },

  deleteProviderProfile: (id) => {
    set((state) => {
      const normalized = normalizeConfig(state.config);
      const deletedManifestId = normalized.providerProfiles.find(
        (profile) => profile.id === id,
      )?.customManifestId;
      const providerProfiles = normalized.providerProfiles.filter(
        (profile) => profile.id !== id,
      );
      const deletedEntryIds = new Set(
        normalized.modelEntries
          .filter((entry) => entry.providerProfileId === id)
          .map((entry) => entry.id),
      );
      const modelEntries = normalized.modelEntries.filter(
        (entry) => !deletedEntryIds.has(entry.id),
      );

      return {
        config: normalizeConfig({
          ...normalized,
          providerProfiles,
          customImageProviderManifests:
            deletedManifestId &&
            !providerProfiles.some(
              (profile) => profile.customManifestId === deletedManifestId,
            )
              ? normalized.customImageProviderManifests.filter(
                  (manifest) => manifest.id !== deletedManifestId,
                )
              : normalized.customImageProviderManifests,
          modelEntries,
          providerApiKeys: Object.fromEntries(
            Object.entries(normalized.providerApiKeys).filter(
              ([profileId]) => profileId !== id,
            ),
          ),
        }),
      };
    });
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  setProviderApiKey: (profileId, apiKey) => {
    const id = profileId.trim();
    if (!id) return;
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        providerApiKeys: {
          ...state.config.providerApiKeys,
          ...(apiKey.trim() ? { [id]: apiKey.trim() } : {}),
        },
      }),
    }));
    if (!apiKey.trim()) {
      set((state) => ({
        config: normalizeConfig({
          ...state.config,
          providerApiKeys: Object.fromEntries(
            Object.entries(state.config.providerApiKeys).filter(
              ([key]) => key !== id,
            ),
          ),
        }),
      }));
    }
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  setModelProviderProfile: (modelEntryId, profileId) => {
    set((state) => {
      const normalized = normalizeConfig(state.config);
      const normalizedProviderId = profileId?.trim() || null;
      const profileExists =
        normalizedProviderId &&
        normalized.providerProfiles.some(
          (profile) => profile.id === normalizedProviderId,
        );
      const modelEntries = normalized.modelEntries.map((entry) =>
        entry.id === modelEntryId
          ? {
              ...entry,
              providerProfileId: profileExists ? normalizedProviderId : null,
              status: profileExists
                ? ("available" as const)
                : ("unbound" as const),
              updatedAt: Date.now(),
            }
          : entry,
      );

      return {
        config: normalizeConfig({
          ...normalized,
          modelEntries,
        }),
      };
    });
    void get()
      .persistLocalVault()
      .catch(() => undefined);
  },

  ensureLocalModelReference: (modelEntryId) => {
    const normalizedModelEntryId = modelEntryId.trim();
    if (
      !normalizedModelEntryId ||
      isLocalModelReference(normalizedModelEntryId)
    )
      return normalizedModelEntryId;

    const existing = findLocalModelReference(
      get().config.localModelBindings,
      normalizedModelEntryId,
    );
    if (existing) return existing;

    const reference = createLocalModelReference(
      Object.keys(get().config.localModelBindings),
    );
    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        localModelBindings: {
          ...state.config.localModelBindings,
          [reference]: normalizedModelEntryId,
        },
      }),
    }));
    return reference;
  },

  bindLocalModelReference: (reference, modelEntryId) => {
    const normalizedModelEntryId = modelEntryId.trim();
    if (
      !isLocalModelReference(reference) ||
      !normalizedModelEntryId ||
      isLocalModelReference(normalizedModelEntryId)
    ) {
      return false;
    }

    const modelExists = get().config.modelEntries.some(
      (model) => model.enabled && model.id === normalizedModelEntryId,
    );
    if (!modelExists) return false;

    set((state) => ({
      config: normalizeConfig({
        ...state.config,
        localModelBindings: {
          ...state.config.localModelBindings,
          [reference]: normalizedModelEntryId,
        },
      }),
    }));
    void get()
      .persistLocalVault()
      .catch(() => undefined);
    return true;
  },

  resolveLocalModelReference: (reference) =>
    resolveLocalModelReference(get().config.localModelBindings, reference),

  getCustomModels: () => normalizeConfig(get().config).modelEntries,

  getEnabledCustomModels: (category) => {
    const normalized = normalizeConfig(get().config);
    return normalized.modelEntries.filter(
      (model) =>
        model.enabled &&
        model.status === "available" &&
        Boolean(model.providerProfileId) &&
        (category ? model.category === category : true),
    );
  },

  getProviderProfiles: () =>
    normalizeConfig(get().config).providerProfiles.filter(
      (profile) => profile.enabled,
    ),

  getModelConfig: (modelEntryId, category) => {
    const normalized = normalizeConfig(get().config);
    const model = normalized.modelEntries.find(
      (item) =>
        item.id === modelEntryId && (!category || item.category === category),
    );
    const profile = model?.providerProfileId
      ? normalized.providerProfiles.find(
          (item) => item.id === model.providerProfileId,
        )
      : undefined;
    const apiKey = profile
      ? normalized.providerApiKeys[profile.id]?.trim()
      : "";

    if (!model || !profile || (profile.authMode !== "none" && !apiKey)) {
      return undefined;
    }
    const customManifest =
      profile.protocol === "custom-http-image-v1"
        ? normalized.customImageProviderManifests.find(
            (manifest) => manifest.id === profile.customManifestId,
          )
        : undefined;
    if (profile.protocol === "custom-http-image-v1" && !customManifest) {
      return undefined;
    }

    return {
      ...model,
      apiKey,
      baseUrl: profile.baseUrl,
      apiUrl: profile.baseUrl,
      provider:
        profile.protocol === "dashscope"
          ? "aliyun"
          : profile.protocol === "custom-http-image-v1"
            ? "custom"
            : "openai",
      protocol: profile.protocol,
      authMode: profile.authMode,
      ...(customManifest ? { customManifest } : {}),
      imageRequestMode: profile.imageRequestMode,
      requestMode: profile.imageRequestMode,
    };
  },
}));
