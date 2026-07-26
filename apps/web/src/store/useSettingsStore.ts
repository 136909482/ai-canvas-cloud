import { create } from "zustand";
import { inferProviderFromApiUrl } from "../config/modelCatalog.ts";
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
  ModelCategory,
  ModelEntry,
  ProviderProfileConfig,
  RuntimeModelConfig,
  StorageConfig,
  TaskQueueSnapshot,
} from "../types/index.ts";
import {
  readWorkspaceConfigCache,
  writeWorkspaceConfigCache,
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
  setWorkspaceRuntimeStatus: (
    status: Pick<
      WorkspaceStatus,
      "configured" | "directoryName" | "permission"
    >,
  ) => void;
  hydrateFromWorkspace: () => Promise<"workspace" | "default">;
  persistWorkspaceConfig: () => Promise<void>;
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

  hydrateFromWorkspace: async () => {
    const cachedWorkspaceConfig = readWorkspaceConfigCache();

    try {
      const workspaceConfig = await platformBridge.loadWorkspaceConfig();
      const hydratedConfig = fromWorkspaceConfigFile(
        workspaceConfig ?? cachedWorkspaceConfig,
      );

      if (workspaceConfig) {
        writeWorkspaceConfigCache(workspaceConfig);
      }

      if (hydratedConfig) {
        set((state) => ({
          config: {
            ...hydratedConfig,
            storage: {
              ...hydratedConfig.storage,
              workspaceConfigured: state.runtime.workspaceConfigured,
              workspaceDirectoryName: state.runtime.workspaceDirectoryName,
            },
          },
          runtime: {
            ...state.runtime,
            hydrated: true,
            lastLoadError: null,
          },
        }));
        return workspaceConfig ? ("workspace" as const) : ("default" as const);
      }

      const defaultConfig = normalizeConfig();
      set((state) => ({
        config: {
          ...defaultConfig,
          storage: {
            ...defaultConfig.storage,
            workspaceConfigured: state.runtime.workspaceConfigured,
            workspaceDirectoryName: state.runtime.workspaceDirectoryName,
          },
        },
        runtime: {
          ...state.runtime,
          hydrated: true,
          lastLoadError: null,
        },
      }));

      return "default" as const;
    } catch (error) {
      const hydratedConfig = fromWorkspaceConfigFile(cachedWorkspaceConfig);

      if (hydratedConfig) {
        set((state) => ({
          config: {
            ...hydratedConfig,
            storage: {
              ...hydratedConfig.storage,
              workspaceConfigured: state.runtime.workspaceConfigured,
              workspaceDirectoryName: state.runtime.workspaceDirectoryName,
            },
          },
          runtime: {
            ...state.runtime,
            hydrated: true,
            lastLoadError:
              error instanceof Error ? error.message : String(error),
          },
        }));
        return "default" as const;
      }

      const defaultConfig = normalizeConfig();
      set((state) => ({
        config: {
          ...defaultConfig,
          storage: {
            ...defaultConfig.storage,
            workspaceConfigured: state.runtime.workspaceConfigured,
            workspaceDirectoryName: state.runtime.workspaceDirectoryName,
          },
        },
        runtime: {
          ...state.runtime,
          hydrated: true,
          lastLoadError: error instanceof Error ? error.message : String(error),
        },
      }));
      return "default" as const;
    }
  },

  persistWorkspaceConfig: async () => {
    const state = get();
    const workspaceConfig = toWorkspaceConfigFile(state.config);

    writeWorkspaceConfigCache(workspaceConfig);

    if (!state.runtime.workspaceConfigured) {
      set((current) => ({
        runtime: {
          ...current.runtime,
          lastSaveError: null,
        },
      }));
      return;
    }

    try {
      await platformBridge.saveWorkspaceConfig(workspaceConfig);
      set((current) => ({
        runtime: {
          ...current.runtime,
          lastSaveError: null,
        },
      }));
    } catch (error) {
      reportDiagnostic({
        area: "persistence",
        title: "配置保存失败",
        error,
        code: "WORKSPACE_CONFIG_SAVE_FAILED",
        context: { operation: "save-config" },
      });
      set((current) => ({
        runtime: {
          ...current.runtime,
          lastSaveError: error instanceof Error ? error.message : String(error),
        },
      }));
      throw error;
    }
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
    set((state) => ({
      config: withoutPrivateSettings(state.config),
      runtime: {
        ...state.runtime,
        vaultStatus: "idle",
        vaultPersistence: "device",
        vaultUserId: null,
        vaultUpdatedAt: null,
        vaultError: null,
      },
    }));
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

    if (!model || !profile || !apiKey) {
      return undefined;
    }

    return {
      ...model,
      apiKey,
      baseUrl: profile.baseUrl,
      apiUrl: profile.baseUrl,
      provider: inferProviderFromApiUrl(profile.baseUrl),
      imageRequestMode: profile.imageRequestMode,
      requestMode: profile.imageRequestMode,
    };
  },
}));
