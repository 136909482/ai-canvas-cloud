import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useFeedbackStore } from "@/store/useFeedbackStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { themeClasses } from "@/styles/themeClasses";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import type {
  CustomModelKind,
  ModelEntry,
  ProviderProfileConfig,
} from "@/types";
import { CanvasSettingsSwitch } from "@/components/toolbar/settingsComponents";
import {
  FIELD_INPUT_CLASS,
  FIELD_SELECT_CLASS,
  MODEL_TABS,
  createEmptyDraft,
  createEmptyProviderDraft,
  cx,
  sanitizeDraftModel,
  sanitizeProviderProfile,
  toDraftModel,
  toDraftProviderProfile,
  type DraftModelCard,
  type DraftProviderProfile,
} from "@/components/toolbar/settingsModel";
import {
  getModelDraftValidationMessage,
  validateProviderProfileDraft,
} from "./providerConfig";
import { ProviderModelImportDialog } from "./ProviderModelImportDialog";

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

export function LocalVaultSettingsPanel() {
  const {
    config,
    deleteCustomModel,
    deleteProviderProfile,
    persistLocalVault,
    saveCustomModel,
    saveProviderDiscoveryImport,
    saveProviderProfile,
  } = useSettingsStore(
    useShallow((state) => ({
      config: state.config,
      deleteCustomModel: state.deleteCustomModel,
      deleteProviderProfile: state.deleteProviderProfile,
      persistLocalVault: state.persistLocalVault,
      saveCustomModel: state.saveCustomModel,
      saveProviderDiscoveryImport: state.saveProviderDiscoveryImport,
      saveProviderProfile: state.saveProviderProfile,
    })),
  );
  const notify = useFeedbackStore((state) => state.notify);
  const confirm = useFeedbackStore((state) => state.confirm);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] =
    useState<DraftProviderProfile | null>(null);
  const [modelDraft, setModelDraft] = useState<DraftModelCard | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [isModelEditorOpen, setIsModelEditorOpen] = useState(false);
  const [isModelDirty, setIsModelDirty] = useState(false);
  const [modelSaveStatus, setModelSaveStatus] = useState<{
    state: "idle" | "saving" | "saved" | "error";
    message?: string;
  }>({ state: "idle" });
  const [modelCopyState, setModelCopyState] = useState<"idle" | "copied">(
    "idle",
  );
  const [isProviderDirty, setIsProviderDirty] = useState(false);
  const [providerSaveStatus, setProviderSaveStatus] = useState<{
    state: "idle" | "saving" | "saved" | "error";
    message?: string;
  }>({ state: "idle" });
  const providerDraftRevision = useRef(0);
  const modelDraftRevision = useRef(0);
  const modelDraftRef = useRef<DraftModelCard | null>(null);
  const modelDirtyRef = useRef(false);

  const providerModelEntries = useMemo(
    () =>
      config.modelEntries.filter(
        (entry) => entry.providerProfileId === selectedProviderId,
      ),
    [config.modelEntries, selectedProviderId],
  );
  const filteredProviderProfiles = useMemo(() => {
    const query = providerSearch.trim().toLowerCase();
    if (!query) return config.providerProfiles;
    return config.providerProfiles.filter((profile) =>
      profile.name.toLowerCase().includes(query),
    );
  }, [config.providerProfiles, providerSearch]);

  useEffect(() => {
    if (isProviderDirty) return;
    if (providerDraft?.id.startsWith("draft-provider-")) return;
    const profile =
      config.providerProfiles.find(
        (candidate) => candidate.id === selectedProviderId,
      ) ??
      config.providerProfiles[0] ??
      null;
    setSelectedProviderId(profile?.id ?? null);
    setProviderDraft(
      profile ? { ...toDraftProviderProfile(profile), apiKey: "" } : null,
    );
  }, [
    config.providerProfiles,
    isProviderDirty,
    providerDraft?.id,
    selectedProviderId,
  ]);

  useEffect(() => {
    modelDraftRef.current = modelDraft;
  }, [modelDraft]);

  useEffect(() => {
    if (isModelEditorOpen) return;
    if (isModelDirty) return;
    if (modelDraft?.id.startsWith("draft-model-")) return;
    const entry =
      config.modelEntries.find(
        (candidate) =>
          candidate.id === selectedModelId &&
          candidate.providerProfileId === selectedProviderId,
      ) ??
      providerModelEntries[0] ??
      null;
    setSelectedModelId(entry?.id ?? null);
    setModelDraft(entry ? toDraftModel(entry) : null);
  }, [
    config.modelEntries,
    isModelDirty,
    isModelEditorOpen,
    modelDraft?.id,
    providerModelEntries,
    selectedModelId,
    selectedProviderId,
  ]);

  const createProvider = () => {
    const draft = createEmptyProviderDraft("image");
    setSelectedProviderId(draft.id);
    setProviderDraft(draft);
    setShowApiKey(false);
    setIsProviderDirty(false);
    setProviderSaveStatus({ state: "idle" });
  };

  const createModel = () => {
    if (!selectedProviderId) return;
    const draft = createEmptyDraft("image");
    draft.providerProfileId = selectedProviderId;
    draft.status = "available";
    setSelectedModelId(draft.id);
    setModelDraft(draft);
    modelDraftRef.current = draft;
    modelDirtyRef.current = false;
    setIsModelDirty(false);
    setModelSaveStatus({ state: "idle" });
    setModelCopyState("idle");
    setIsModelEditorOpen(true);
  };

  const selectProvider = (id: string) => {
    const profile = config.providerProfiles.find(
      (candidate) => candidate.id === id,
    );
    if (!profile) return;
    setSelectedProviderId(id);
    setProviderDraft({ ...toDraftProviderProfile(profile), apiKey: "" });
    setShowApiKey(false);
    setSelectedModelId(null);
    setModelDraft(null);
    modelDraftRef.current = null;
    modelDirtyRef.current = false;
    setIsModelEditorOpen(false);
    setIsModelDirty(false);
    setModelSaveStatus({ state: "idle" });
    setIsProviderDirty(false);
    setProviderSaveStatus({ state: "idle" });
  };

  const openModelEditor = (id: string) => {
    const entry = config.modelEntries.find((candidate) => candidate.id === id);
    if (!entry) return;
    const draft = toDraftModel(entry);
    setSelectedModelId(id);
    setModelDraft(draft);
    modelDraftRef.current = draft;
    modelDirtyRef.current = false;
    setIsModelDirty(false);
    setModelSaveStatus({ state: "idle" });
    setModelCopyState("idle");
    setIsModelEditorOpen(true);
  };

  const updateProviderDraft = (
    updater: (draft: DraftProviderProfile) => DraftProviderProfile,
  ) => {
    providerDraftRevision.current += 1;
    setProviderDraft((current) => (current ? updater(current) : current));
    setIsProviderDirty(true);
    setProviderSaveStatus({ state: "idle" });
  };

  const saveProvider = useCallback(
    async (providerDraftToSave: DraftProviderProfile, revision: number) => {
      const draft = sanitizeProviderProfile(providerDraftToSave);
      const apiKey = draft.apiKey || config.providerApiKeys[draft.id] || "";
      const diagnostic = validateProviderProfileDraft(draft, apiKey);
      if (diagnostic) {
        if (providerDraftRevision.current === revision) {
          setProviderSaveStatus({
            state: "error",
            message: diagnostic.message,
          });
        }
        return;
      }
      const duplicate = config.providerProfiles.find(
        (candidate) =>
          candidate.id !== draft.id &&
          candidate.name.trim().toLocaleLowerCase() ===
            draft.name.trim().toLocaleLowerCase(),
      );
      if (duplicate) {
        if (providerDraftRevision.current === revision) {
          setProviderSaveStatus({
            state: "error",
            message: "服务商名称已存在，请使用另一个名称",
          });
        }
        return;
      }

      const existingProfile = config.providerProfiles.find(
        (candidate) => candidate.id === draft.id,
      );
      const needsRediscovery =
        Boolean(draft.apiKey) ||
        (existingProfile?.baseUrl !== undefined &&
          existingProfile.baseUrl !== draft.baseUrl);

      const profile = {
        id: draft.id,
        name: draft.name,
        protocol: draft.protocol,
        baseUrl: draft.baseUrl,
        enabled: draft.enabled,
        imageRequestMode: draft.imageRequestMode,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        ...(draft.lastDiscoveryAt && !needsRediscovery
          ? { lastDiscoveryAt: draft.lastDiscoveryAt }
          : {}),
      };
      saveProviderProfile(profile, draft.apiKey || undefined);
      await persistLocalVault();
      if (providerDraftRevision.current !== revision) return;
      setSelectedProviderId(profile.id);
      setProviderDraft({ ...draft, apiKey: "" });
      setIsProviderDirty(false);
      setProviderSaveStatus({
        state: "saved",
        message: needsRediscovery
          ? "已保存，建议重新获取模型列表"
          : "已自动保存",
      });
    },
    [
      config.providerApiKeys,
      config.providerProfiles,
      persistLocalVault,
      saveProviderProfile,
    ],
  );

  useEffect(() => {
    if (
      !providerDraft ||
      !isProviderDirty ||
      providerSaveStatus.state === "saving"
    )
      return;
    const revision = providerDraftRevision.current;
    const timer = window.setTimeout(() => {
      setProviderSaveStatus({ state: "saving", message: "正在自动保存" });
      void saveProvider(providerDraft, revision);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [isProviderDirty, providerDraft, providerSaveStatus.state, saveProvider]);

  const closeImportDialog = () => setImportDialogOpen(false);

  const importDiscoveredModels = async (input: {
    baseUrl: string;
    discoveredModelIds: string[];
    selectedModels: Array<{
      modelId: string;
      category: CustomModelKind;
      displayName?: string;
    }>;
  }) => {
    if (!providerDraft) return;
    const draft = sanitizeProviderProfile(providerDraft);
    const apiKey = draft.apiKey || config.providerApiKeys[draft.id] || "";
    const diagnostic = validateProviderProfileDraft(
      { ...draft, baseUrl: input.baseUrl },
      apiKey,
    );
    if (diagnostic) throw new Error(diagnostic.message);

    const duplicate = config.providerProfiles.find(
      (candidate) =>
        candidate.id !== draft.id &&
        candidate.name.trim().toLocaleLowerCase() ===
          draft.name.trim().toLocaleLowerCase(),
    );
    if (duplicate) throw new Error("服务商名称已存在，请使用另一个名称");

    const discoveredAt = Date.now();
    const profile: ProviderProfileConfig = {
      id: draft.id,
      name: draft.name,
      protocol: draft.protocol,
      baseUrl: input.baseUrl,
      enabled: draft.enabled,
      imageRequestMode: draft.imageRequestMode,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      lastDiscoveryAt: discoveredAt,
    };
    await saveProviderDiscoveryImport({
      profile,
      apiKey,
      discoveredModelIds: input.discoveredModelIds,
      selectedModels: input.selectedModels,
      discoveredAt,
    });
    setSelectedProviderId(profile.id);
    setProviderDraft({ ...toDraftProviderProfile(profile), apiKey: "" });
    setIsProviderDirty(false);
    setProviderSaveStatus({ state: "saved", message: "已自动保存" });
    notify({
      title: `服务商已保存，新增 ${input.selectedModels.length} 个模型`,
      tone: "success",
    });
  };

  const discoveryDraft = providerDraft
    ? {
        ...providerDraft,
        apiKey:
          providerDraft.apiKey ||
          config.providerApiKeys[providerDraft.id] ||
          "",
      }
    : null;

  const saveExistingModelDraft = useCallback(
    async (draftToSave: DraftModelCard, revision: number) => {
      if (
        draftToSave.id.startsWith("draft-model-") ||
        !draftToSave.providerProfileId
      )
        return;

      const draft = sanitizeDraftModel({
        ...draftToSave,
        status: "available",
      });
      const message = getModelDraftValidationMessage(draft);
      if (message) {
        if (modelDraftRevision.current === revision) {
          setModelSaveStatus({ state: "error", message });
        }
        return;
      }

      const now = Date.now();
      const entry: ModelEntry = {
        ...draft,
        status: "available",
        createdAt:
          config.modelEntries.find((candidate) => candidate.id === draft.id)
            ?.createdAt ?? now,
        updatedAt: now,
      };
      saveCustomModel(entry);
      try {
        await persistLocalVault();
      } catch {
        if (modelDraftRevision.current === revision) {
          setModelSaveStatus({
            state: "error",
            message: "自动保存失败，请重试",
          });
        }
        return;
      }

      if (modelDraftRevision.current !== revision) return;
      const savedDraft = toDraftModel(entry);
      modelDraftRef.current = savedDraft;
      modelDirtyRef.current = false;
      setModelDraft(savedDraft);
      setIsModelDirty(false);
      setModelSaveStatus({ state: "saved", message: "已自动保存" });
    },
    [config.modelEntries, persistLocalVault, saveCustomModel],
  );

  useEffect(() => {
    if (
      !isModelEditorOpen ||
      !isModelDirty ||
      !modelDraft ||
      modelDraft.id.startsWith("draft-model-") ||
      modelSaveStatus.state === "saving"
    )
      return;

    const revision = modelDraftRevision.current;
    const timer = window.setTimeout(() => {
      setModelSaveStatus({ state: "saving", message: "正在自动保存" });
      void saveExistingModelDraft(modelDraft, revision);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    isModelDirty,
    isModelEditorOpen,
    modelDraft,
    modelSaveStatus.state,
    saveExistingModelDraft,
  ]);

  const closeModelEditor = useCallback(() => {
    const currentDraft = modelDraftRef.current;
    if (
      currentDraft &&
      modelDirtyRef.current &&
      !currentDraft.id.startsWith("draft-model-")
    ) {
      setModelSaveStatus({ state: "saving", message: "正在自动保存" });
      void saveExistingModelDraft(currentDraft, modelDraftRevision.current);
    }
    setIsModelEditorOpen(false);
  }, [saveExistingModelDraft]);

  const modelDialogRef = useDialogFocus<HTMLDivElement>(
    isModelEditorOpen,
    closeModelEditor,
    "[data-autofocus]",
  );

  const updateModelDisplayName = (displayName: string) => {
    if (!modelDraft) return;
    const nextDraft = { ...modelDraft, displayName };
    setModelDraft(nextDraft);
    modelDraftRef.current = nextDraft;
    if (modelDraft.id.startsWith("draft-model-")) return;
    modelDraftRevision.current += 1;
    modelDirtyRef.current = true;
    setIsModelDirty(true);
    setModelSaveStatus({ state: "idle" });
  };

  const copyModelId = async () => {
    if (!modelDraft?.modelId) return;
    try {
      await copyTextToClipboard(modelDraft.modelId);
      setModelCopyState("copied");
      window.setTimeout(() => setModelCopyState("idle"), 1600);
    } catch {
      notify({ title: "复制模型 ID 失败", tone: "error" });
    }
  };

  const createManualModel = async () => {
    if (!modelDraft || !selectedProviderId) return;
    const draft = sanitizeDraftModel({
      ...modelDraft,
      providerProfileId: selectedProviderId,
      status: "available",
    });
    const message = getModelDraftValidationMessage(draft);
    if (message) {
      notify({ title: message, tone: "error" });
      return;
    }

    const now = Date.now();
    const entry: ModelEntry = {
      ...draft,
      status: "available",
      createdAt:
        config.modelEntries.find((candidate) => candidate.id === draft.id)
          ?.createdAt ?? now,
      updatedAt: now,
    };
    saveCustomModel(entry);
    await persistLocalVault();
    setSelectedModelId(entry.id);
    setModelDraft(toDraftModel(entry));
    modelDraftRef.current = toDraftModel(entry);
    setIsModelEditorOpen(false);
    notify({ title: "模型已添加到本地 Vault", tone: "success" });
  };

  const removeProvider = async () => {
    if (!providerDraft || providerDraft.id.startsWith("draft-provider-"))
      return;
    if (
      !(await confirm({
        title: "删除服务商",
        message: "该服务商下的模型条目会一并删除。",
        confirmLabel: "删除",
        tone: "danger",
      }))
    )
      return;
    deleteProviderProfile(providerDraft.id);
    await persistLocalVault().catch(() => undefined);
    setProviderDraft(null);
    setSelectedProviderId(null);
    setModelDraft(null);
    setSelectedModelId(null);
    setIsModelEditorOpen(false);
    setIsProviderDirty(false);
    setProviderSaveStatus({ state: "idle" });
  };

  const removeModel = async (entry: ModelEntry) => {
    deleteCustomModel(entry.id);
    await persistLocalVault().catch(() => undefined);
    if (selectedModelId === entry.id) {
      setModelDraft(null);
      setSelectedModelId(null);
    }
    setIsModelEditorOpen(false);
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid min-h-0 flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-[var(--border-subtle)] md:border-b-0 md:border-r">
            <label className="relative m-2 block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={providerSearch}
                onChange={(event) => setProviderSearch(event.target.value)}
                placeholder="搜索服务商"
                className="h-8 w-full rounded-[7px] border border-[var(--border-subtle)] bg-[var(--control-bg)] pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-violet-400/60"
              />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
              {filteredProviderProfiles.map((profile) => {
                const active = selectedProviderId === profile.id;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => selectProvider(profile.id)}
                    className={cx(
                      "w-full rounded-[7px] border px-3 py-2.5 text-left text-xs transition",
                      active
                        ? "border-[var(--border-subtle)] bg-[var(--control-bg-hover)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--control-bg)]",
                    )}
                  >
                    <span className="block truncate font-medium">
                      {profile.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="p-2">
              <button
                type="button"
                onClick={createProvider}
                className={`${themeClasses.secondaryButton} h-8 w-full gap-1.5 rounded-[7px] text-xs`}
              >
                <Plus className="h-3.5 w-3.5" />
                添加服务商
              </button>
            </div>
          </aside>
          <section className="project-manager-scrollbar min-h-0 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]">
            {providerDraft ? (
              <div className="mx-auto max-w-3xl space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      服务商配置
                    </span>
                    {providerSaveStatus.state !== "idle" ? (
                      <span
                        aria-live="polite"
                        className={cx(
                          "ml-2 text-[10px]",
                          providerSaveStatus.state === "error"
                            ? "text-red-400"
                            : themeClasses.textMuted,
                        )}
                      >
                        {providerSaveStatus.message}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <CanvasSettingsSwitch
                      checked={providerDraft.enabled}
                      label={
                        providerDraft.enabled ? "停用此服务商" : "启用此服务商"
                      }
                      onChange={() =>
                        updateProviderDraft((draft) => ({
                          ...draft,
                          enabled: !draft.enabled,
                        }))
                      }
                    />
                    {!providerDraft.id.startsWith("draft-provider-") ? (
                      <button
                        type="button"
                        onClick={() => void removeProvider()}
                        aria-label="删除服务商"
                        title="删除服务商"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span>显示名称</span>
                  <input
                    className={FIELD_INPUT_CLASS}
                    value={providerDraft.name}
                    onChange={(event) =>
                      updateProviderDraft((draft) => ({
                        ...draft,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" />
                    Base URL
                  </span>
                  <input
                    type="url"
                    className={FIELD_INPUT_CLASS}
                    value={providerDraft.baseUrl}
                    onChange={(event) =>
                      updateProviderDraft((draft) => ({
                        ...draft,
                        baseUrl: event.target.value,
                      }))
                    }
                    autoComplete="off"
                  />
                </label>
                <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    API Key
                  </span>
                  <span className="relative block">
                    <input
                      type={showApiKey ? "text" : "password"}
                      className={cx(FIELD_INPUT_CLASS, "pr-10")}
                      value={providerDraft.apiKey}
                      onChange={(event) =>
                        updateProviderDraft((draft) => ({
                          ...draft,
                          apiKey: event.target.value,
                        }))
                      }
                      autoComplete="off"
                      placeholder={
                        config.providerApiKeys[providerDraft.id]
                          ? "已保存，输入新 Key 可更换"
                          : ""
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((value) => !value)}
                      className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[var(--text-muted)]"
                      aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {showApiKey ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </span>
                </label>
                <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <span>图像请求模式</span>
                  <select
                    className={FIELD_SELECT_CLASS}
                    value={providerDraft.imageRequestMode}
                    onChange={(event) =>
                      updateProviderDraft((draft) => ({
                        ...draft,
                        imageRequestMode: event.target.value as
                          "sync" | "async",
                      }))
                    }
                  >
                    <option value="sync">同步</option>
                    <option value="async">异步轮询</option>
                  </select>
                </label>
                <section className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      模型
                    </span>
                    <div
                      role="group"
                      aria-label="模型导入方式"
                      className="inline-flex h-8 overflow-hidden rounded-[7px] border border-[var(--border-subtle)] bg-[var(--control-bg)]"
                    >
                      <button
                        type="button"
                        onClick={() => setImportDialogOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/60"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        获取模型列表
                      </button>
                      <button
                        type="button"
                        onClick={createModel}
                        aria-label="手工添加模型"
                        title="手工添加模型"
                        className="inline-flex w-8 items-center justify-center border-l border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/60"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {providerModelEntries.length > 0 ? (
                    <div className="overflow-hidden rounded-[7px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
                      {providerModelEntries.map((entry) => {
                        const categoryLabel =
                          MODEL_TABS.find((tab) => tab.id === entry.category)
                            ?.label ?? entry.category;
                        const active =
                          isModelEditorOpen && selectedModelId === entry.id;
                        return (
                          <div
                            key={entry.id}
                            className={cx(
                              "group flex min-w-0 items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0",
                              active
                                ? "bg-[var(--accent-violet-soft)]"
                                : "hover:bg-[var(--control-bg-hover)]",
                              !entry.enabled && "opacity-55",
                            )}
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-emerald-400/20 bg-emerald-400/10 text-[11px] font-semibold text-emerald-300">
                              {categoryLabel.slice(0, 1)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-[var(--text-primary)]">
                                {entry.displayName || entry.modelId}
                              </span>
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openModelEditor(entry.id)}
                                aria-label={`设置模型 ${entry.displayName || entry.modelId}`}
                                title="设置模型"
                                className={`${themeClasses.iconButton} h-7 w-7 rounded-[6px]`}
                              >
                                <Settings2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeModel(entry)}
                                aria-label={`移除模型 ${entry.displayName || entry.modelId}`}
                                title="移除模型"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className={`border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-xs ${themeClasses.textMuted}`}
                    >
                      该服务商尚未导入模型
                    </div>
                  )}
                </section>
              </div>
            ) : null}
            {!providerDraft ? (
              <div
                className={`flex h-full min-h-40 items-center justify-center text-center text-xs ${themeClasses.textMuted}`}
              >
                使用左侧按钮添加服务商
              </div>
            ) : null}
          </section>
        </div>
      </div>
      <ProviderModelImportDialog
        open={importDialogOpen}
        draft={discoveryDraft}
        existingEntries={config.modelEntries}
        onClose={closeImportDialog}
        onAddModel={importDiscoveredModels}
      />
      {providerDraft && modelDraft && isModelEditorOpen
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-5">
              <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="关闭模型设置"
                onClick={closeModelEditor}
              />
              <div
                ref={modelDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="model-settings-dialog-title"
                tabIndex={-1}
                className="relative flex min-h-[17rem] max-h-[calc(100dvh-1.5rem)] w-[min(32rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] shadow-2xl"
              >
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5 sm:px-5">
                  <div className="min-w-0">
                    <h2
                      id="model-settings-dialog-title"
                      className="truncate text-sm font-semibold text-[var(--text-primary)]"
                    >
                      {modelDraft.id.startsWith("draft-model-")
                        ? "手工添加模型"
                        : "模型设置"}
                    </h2>
                    <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
                      {providerDraft.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeModelEditor}
                    aria-label="关闭模型设置"
                    title="关闭"
                    className={`${themeClasses.iconButton} h-8 w-8 rounded-[6px]`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>

                <div className="project-manager-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable] sm:px-5">
                  <div className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                    <div className="flex min-h-4 items-center justify-between gap-3">
                      <label htmlFor="model-display-name">显示名称</label>
                      {!modelDraft.id.startsWith("draft-model-") ? (
                        <span
                          aria-hidden="true"
                          className={cx(
                            "inline-flex items-center gap-1 text-[10px]",
                            modelSaveStatus.state === "error"
                              ? "text-red-300"
                              : "text-[var(--text-muted)]",
                          )}
                        >
                          {modelSaveStatus.state === "saving" ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : modelSaveStatus.state === "saved" ? (
                            <Check className="h-3 w-3 text-emerald-300" />
                          ) : null}
                          {modelSaveStatus.message}
                        </span>
                      ) : null}
                    </div>
                    <input
                      id="model-display-name"
                      data-autofocus
                      className={FIELD_INPUT_CLASS}
                      value={modelDraft.displayName}
                      onChange={(event) =>
                        updateModelDisplayName(event.target.value)
                      }
                    />
                    {!modelDraft.id.startsWith("draft-model-") ? (
                      <span className="sr-only" aria-live="polite">
                        {modelSaveStatus.message}
                      </span>
                    ) : null}
                  </div>
                  {modelDraft.id.startsWith("draft-model-") ? (
                    <>
                      <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                        <span>模型 ID</span>
                        <input
                          className={FIELD_INPUT_CLASS}
                          value={modelDraft.modelId}
                          onChange={(event) => {
                            const nextDraft = {
                              ...modelDraft,
                              modelId: event.target.value,
                            };
                            setModelDraft(nextDraft);
                            modelDraftRef.current = nextDraft;
                          }}
                          autoComplete="off"
                        />
                      </label>
                      <label className="block space-y-1.5 text-xs text-[var(--text-secondary)]">
                        <span>类别</span>
                        <select
                          className={FIELD_SELECT_CLASS}
                          value={modelDraft.category}
                          onChange={(event) => {
                            const nextDraft = {
                              ...modelDraft,
                              category: event.target.value as CustomModelKind,
                            };
                            setModelDraft(nextDraft);
                            modelDraftRef.current = nextDraft;
                          }}
                        >
                          {MODEL_TABS.map((tab) => (
                            <option key={tab.id} value={tab.id}>
                              {tab.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <div className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                      <span id="model-id-label" className="block">
                        模型 ID
                      </span>
                      <div className="relative">
                        <input
                          aria-labelledby="model-id-label"
                          aria-readonly="true"
                          className={`${FIELD_INPUT_CLASS} cursor-not-allowed border-[color-mix(in_srgb,var(--border-subtle)_55%,var(--text-muted)_45%)] bg-[color-mix(in_srgb,var(--control-bg)_55%,var(--canvas-bg)_45%)] pr-10 text-[var(--text-muted)] opacity-75 focus:border-[color-mix(in_srgb,var(--border-subtle)_55%,var(--text-muted)_45%)] focus:bg-[color-mix(in_srgb,var(--control-bg)_55%,var(--canvas-bg)_45%)]`}
                          value={modelDraft.modelId}
                          readOnly
                        />
                        <button
                          type="button"
                          onClick={() => void copyModelId()}
                          aria-label={
                            modelCopyState === "copied"
                              ? "模型 ID 已复制"
                              : "复制模型 ID"
                          }
                          title={
                            modelCopyState === "copied" ? "已复制" : "复制"
                          }
                          className={`${themeClasses.iconButton} absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-[6px]`}
                        >
                          {modelCopyState === "copied" ? (
                            <Check className="h-3.5 w-3.5 text-emerald-300" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {modelDraft.id.startsWith("draft-model-") ? (
                  <footer className="flex shrink-0 justify-end border-t border-[var(--border-subtle)] px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => void createManualModel()}
                      className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--canvas-bg)]"
                    >
                      添加模型
                    </button>
                  </footer>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
