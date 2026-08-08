import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Clipboard,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FileUp,
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
  ProviderAuthMode,
  ProviderProtocol,
  ProviderProfileConfig,
} from "@/types";
import { CanvasSettingsSwitch } from "@/components/toolbar/settingsComponents";
import { ModelOptionIcon } from "@/components/icons/ModelOptionIcon";
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
import {
  createCustomImageProviderImport,
  createDefaultCustomImageProviderManifest,
  CUSTOM_IMAGE_PROVIDER_LLM_PROMPT,
  parseCustomImageProviderImportText,
  parseCustomImageProviderManifest,
} from "./customImageProviderManifest";

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

function formatManifestFeedback(error: unknown, action: string) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("不是有效 JSON")) {
    return `${action}失败：这不是有效的 JSON。请检查括号、引号和逗号。`;
  }
  if (detail.includes("导入文件.defaults.apiKey")) {
    return `${action}失败：导入包不能包含 API Key，请删除密钥后再试。`;
  }
  return `${action}失败：${detail}。请按字段路径检查 Manifest。`;
}

export function LocalVaultSettingsPanel() {
  const {
    config,
    customImageProviderManifests,
    deleteCustomModel,
    deleteProviderProfile,
    persistLocalVault,
    saveCustomModel,
    saveCustomImageProviderManifest,
    saveProviderDiscoveryImport,
    saveProviderProfile,
  } = useSettingsStore(
    useShallow((state) => ({
      config: state.config,
      customImageProviderManifests: state.config.customImageProviderManifests,
      deleteCustomModel: state.deleteCustomModel,
      deleteProviderProfile: state.deleteProviderProfile,
      persistLocalVault: state.persistLocalVault,
      saveCustomModel: state.saveCustomModel,
      saveCustomImageProviderManifest: state.saveCustomImageProviderManifest,
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
  const [isApiKeyEditing, setIsApiKeyEditing] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [manifestText, setManifestText] = useState("");
  const [manifestStatus, setManifestStatus] = useState<string | null>(null);
  const manifestFileRef = useRef<HTMLInputElement | null>(null);
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
  const isSavedProviderDraft = Boolean(
    providerDraft &&
    config.providerProfiles.some((profile) => profile.id === providerDraft.id),
  );
  const savedProviderApiKey = providerDraft
    ? (config.providerApiKeys[providerDraft.id] ?? "")
    : "";
  const apiKeyDisplayValue =
    isApiKeyEditing || !savedProviderApiKey
      ? (providerDraft?.apiKey ?? "")
      : showApiKey
        ? savedProviderApiKey
        : "********";
  const activeCustomManifest = providerDraft?.customManifestId
    ? customImageProviderManifests.find(
        (manifest) => manifest.id === providerDraft.customManifestId,
      )
    : undefined;

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
    const manifest = profile?.customManifestId
      ? config.customImageProviderManifests.find(
          (candidate) => candidate.id === profile.customManifestId,
        )
      : undefined;
    setManifestText(
      manifest
        ? JSON.stringify(createCustomImageProviderImport(manifest), null, 2)
        : "",
    );
    setManifestStatus(null);
    setShowApiKey(false);
    setIsApiKeyEditing(false);
  }, [
    config.providerApiKeys,
    config.providerProfiles,
    config.customImageProviderManifests,
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

  const createProvider = (protocol: ProviderProtocol) => {
    const draft = createEmptyProviderDraft("image");
    const defaults: Record<ProviderProtocol, Partial<DraftProviderProfile>> = {
      "openai-compatible": {
        name: "OpenAI Compatible",
        authMode: "bearer",
        baseUrl: "https://api.openai.com/v1",
      },
      dashscope: {
        name: "阿里百炼",
        authMode: "bearer",
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
      },
      "custom-http-image-v1": {
        name: "我的自定义服务商",
        authMode: "bearer",
        baseUrl: "",
      },
    };
    Object.assign(draft, defaults[protocol], { protocol });
    if (protocol === "custom-http-image-v1") {
      const manifest = createDefaultCustomImageProviderManifest("sync");
      saveCustomImageProviderManifest(manifest);
      draft.customManifestId = manifest.id;
      setManifestText(
        JSON.stringify(createCustomImageProviderImport(manifest), null, 2),
      );
    } else {
      setManifestText("");
    }
    setSelectedProviderId(draft.id);
    setProviderDraft(draft);
    setShowApiKey(false);
    setIsApiKeyEditing(false);
    setIsProviderDirty(false);
    setProviderSaveStatus({ state: "idle" });
    setProviderPickerOpen(false);
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
    setIsApiKeyEditing(false);
    setSelectedModelId(null);
    setModelDraft(null);
    modelDraftRef.current = null;
    modelDirtyRef.current = false;
    setIsModelEditorOpen(false);
    setIsModelDirty(false);
    setModelSaveStatus({ state: "idle" });
    setIsProviderDirty(false);
    setProviderSaveStatus({ state: "idle" });
    const manifest = profile.customManifestId
      ? config.customImageProviderManifests.find(
          (candidate) => candidate.id === profile.customManifestId,
        )
      : undefined;
    setManifestText(
      manifest
        ? JSON.stringify(createCustomImageProviderImport(manifest), null, 2)
        : "",
    );
    setManifestStatus(null);
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
      // A saved provider's protocol is immutable. The only way to use a
      // different protocol is to create a new provider profile.
      const protocol = existingProfile?.protocol ?? draft.protocol;
      const needsRediscovery =
        (draft.apiKey
          ? draft.apiKey !== (config.providerApiKeys[draft.id] ?? "")
          : false) ||
        (existingProfile?.baseUrl !== undefined &&
          existingProfile.baseUrl !== draft.baseUrl);

      const profile: ProviderProfileConfig = {
        id: draft.id,
        name: draft.name,
        protocol,
        authMode:
          protocol === "custom-http-image-v1" ? draft.authMode : "bearer",
        baseUrl: draft.baseUrl,
        enabled: draft.enabled,
        ...(protocol === "custom-http-image-v1" && draft.customManifestId
          ? { customManifestId: draft.customManifestId }
          : {}),
        imageRequestMode:
          protocol === "custom-http-image-v1" ? draft.imageRequestMode : "sync",
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
      setIsApiKeyEditing(false);
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

  const validateAndSaveManifest = async () => {
    if (!providerDraft || providerDraft.protocol !== "custom-http-image-v1")
      return;
    try {
      const parsed = parseCustomImageProviderImportText(manifestText);
      const manifest = parseCustomImageProviderManifest(parsed.manifest, {
        id: providerDraft.customManifestId,
      });
      saveCustomImageProviderManifest(manifest);
      updateProviderDraft((draft) => ({
        ...draft,
        customManifestId: manifest.id,
        ...(parsed.defaults?.providerName
          ? { name: parsed.defaults.providerName }
          : {}),
        ...(parsed.defaults?.baseUrl
          ? { baseUrl: parsed.defaults.baseUrl }
          : {}),
        ...(parsed.defaults?.authMode
          ? { authMode: parsed.defaults.authMode }
          : {}),
        imageRequestMode:
          manifest.executionMode === "polling" ? "async" : "sync",
      }));
      await persistLocalVault();
      setManifestText(
        JSON.stringify(createCustomImageProviderImport(manifest), null, 2),
      );
      setManifestStatus(
        `Manifest 已验证并保存，当前模式：${
          manifest.executionMode === "polling" ? "异步轮询" : "同步"
        }`,
      );
    } catch (error) {
      setManifestStatus(formatManifestFeedback(error, "Manifest 验证"));
    }
  };

  const importManifestFile = async (file: File) => {
    try {
      const text = await file.text();
      const imported = parseCustomImageProviderImportText(text);
      setManifestText(JSON.stringify(imported, null, 2));
      const summary = [
        imported.manifest.executionMode === "polling" ? "异步轮询" : "同步",
        imported.manifest.capabilities.edit ? "支持编辑" : "仅生成",
        imported.defaults?.suggestedModels?.length
          ? `${imported.defaults.suggestedModels.length} 个建议模型`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      setManifestStatus(`校验通过：${summary}。点击“验证并保存”确认写入`);
    } catch (error) {
      setManifestStatus(formatManifestFeedback(error, "Manifest 导入"));
    }
  };

  const exportManifest = () => {
    if (!providerDraft?.customManifestId) return;
    const manifest = customImageProviderManifests.find(
      (candidate) => candidate.id === providerDraft.customManifestId,
    );
    if (!manifest) return;
    const payload = createCustomImageProviderImport(manifest, {
      providerName: providerDraft.name,
      baseUrl: providerDraft.baseUrl,
      authMode: providerDraft.authMode,
      suggestedModels: providerModelEntries.map((entry) => ({
        modelId: entry.modelId,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
      })),
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${providerDraft.name.trim() || "custom-image-provider"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

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
      authMode: draft.authMode,
      baseUrl: input.baseUrl,
      enabled: draft.enabled,
      imageRequestMode: "sync",
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
    setIsApiKeyEditing(false);
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
    if (!providerDraft || !isSavedProviderDraft) return;
    if (
      !(await confirm({
        title: "删除服务商",
        message:
          "该服务商的 API Key、模型条目和自定义协议配置会从本设备删除。项目中的节点不会被删除，但原来绑定的模型需要重新选择。",
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
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                      {profile.protocol === "dashscope"
                        ? "阿里百炼"
                        : profile.protocol === "custom-http-image-v1"
                          ? "自定义服务商"
                          : "OpenAI Compatible"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="p-2">
              <button
                type="button"
                onClick={() => setProviderPickerOpen(true)}
                className={`${themeClasses.secondaryButton} h-8 w-full gap-1.5 rounded-[7px] text-xs`}
              >
                <Plus className="h-3.5 w-3.5" />
                添加服务商
              </button>
            </div>
          </aside>
          <section className="project-manager-scrollbar min-h-0 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]">
            {providerDraft ? (
              <div className="mx-auto max-w-3xl space-y-3">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      title={providerDraft.name.trim() || "未命名服务商"}
                      className="truncate text-xs font-medium text-[var(--text-primary)]"
                    >
                      {providerDraft.name.trim() || "未命名服务商"}
                    </span>
                    {providerSaveStatus.state !== "idle" ? (
                      <span
                        aria-live="polite"
                        className={cx(
                          "shrink-0 text-[10px]",
                          providerSaveStatus.state === "error"
                            ? "text-red-400"
                            : themeClasses.textMuted,
                        )}
                      >
                        {providerSaveStatus.message}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isSavedProviderDraft ? (
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
                  </div>
                </div>
                <label className="block space-y-1 text-xs text-[var(--text-secondary)]">
                  <span className="block leading-4">显示名称</span>
                  <input
                    name="provider-display-name"
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
                <label className="block space-y-1 text-xs text-[var(--text-secondary)]">
                  <span className="flex items-center gap-1.5 leading-4">
                    <Link2 className="h-3.5 w-3.5" />
                    Base URL
                  </span>
                  <input
                    type="url"
                    name="provider-base-url"
                    className={FIELD_INPUT_CLASS}
                    value={providerDraft.baseUrl}
                    onChange={(event) =>
                      updateProviderDraft((draft) => ({
                        ...draft,
                        baseUrl: event.target.value,
                      }))
                    }
                    autoComplete="url"
                    spellCheck={false}
                    placeholder={
                      providerDraft.protocol === "custom-http-image-v1"
                        ? "例如 https://your-gateway.example.com"
                        : "例如 https://api.openai.com/v1"
                    }
                  />
                </label>
                <label className="block space-y-1 text-xs text-[var(--text-secondary)]">
                  <span className="flex items-center gap-1.5 leading-4">
                    <KeyRound className="h-3.5 w-3.5" />
                    API Key
                  </span>
                  <span className="relative block">
                    <input
                      type={showApiKey ? "text" : "password"}
                      name="provider-api-key"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      className={cx(FIELD_INPUT_CLASS, "pr-10")}
                      value={apiKeyDisplayValue}
                      onFocus={() => {
                        if (isApiKeyEditing || !savedProviderApiKey) return;
                        setProviderDraft((current) =>
                          current
                            ? { ...current, apiKey: savedProviderApiKey }
                            : current,
                        );
                        setIsApiKeyEditing(true);
                      }}
                      onChange={(event) =>
                        updateProviderDraft((draft) => ({
                          ...draft,
                          apiKey: event.target.value,
                        }))
                      }
                      autoComplete="new-password"
                      placeholder="输入 API Key"
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
                {providerDraft.protocol === "custom-http-image-v1" ? (
                  <>
                    <div className="border-t border-[var(--border-subtle)] pt-3">
                      <p className="text-xs font-medium text-[var(--text-primary)]">
                        高级协议配置
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
                        只有特殊接口才需要修改这里。API Key 不要粘贴进
                        Manifest。
                      </p>
                    </div>
                    <label className="block space-y-1 text-xs text-[var(--text-secondary)]">
                      <span className="block leading-4">鉴权方式</span>
                      <select
                        className={FIELD_SELECT_CLASS}
                        value={providerDraft.authMode}
                        onChange={(event) =>
                          updateProviderDraft((draft) => ({
                            ...draft,
                            authMode: event.target.value as ProviderAuthMode,
                          }))
                        }
                      >
                        <option value="bearer">Bearer</option>
                        <option value="x-api-key">X-API-Key</option>
                        <option value="api-key">API-Key</option>
                        <option value="none">无需鉴权</option>
                      </select>
                    </label>
                    <section className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--text-primary)]">
                          自定义 Manifest
                        </span>
                        <div className="flex items-center gap-1">
                          <input
                            ref={manifestFileRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.currentTarget.value = "";
                              if (file) void importManifestFile(file);
                            }}
                          />
                          <button
                            type="button"
                            title="导入 JSON"
                            aria-label="导入 JSON"
                            onClick={() => manifestFileRef.current?.click()}
                            className={`${themeClasses.iconButton} h-7 w-7 rounded-[6px]`}
                          >
                            <FileUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="导出（不含密钥）"
                            aria-label="导出（不含密钥）"
                            onClick={exportManifest}
                            className={`${themeClasses.iconButton} h-7 w-7 rounded-[6px]`}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="复制 LLM 提示词"
                            aria-label="复制 LLM 提示词"
                            onClick={() =>
                              void copyTextToClipboard(
                                CUSTOM_IMAGE_PROVIDER_LLM_PROMPT,
                              )
                            }
                            className={`${themeClasses.iconButton} h-7 w-7 rounded-[6px]`}
                          >
                            <Clipboard className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] leading-4 text-[var(--text-muted)]">
                        把服务商接口文档转换成 JSON
                        粘贴到这里；只有点击“验证并保存”后才会生效。
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        执行模式：
                        {activeCustomManifest
                          ? activeCustomManifest.executionMode === "polling"
                            ? "异步轮询"
                            : "同步"
                          : "未配置"}
                      </p>
                      <textarea
                        className="min-h-48 w-full resize-y rounded-[8px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--text-primary)] outline-none focus:border-violet-400/60"
                        value={manifestText}
                        onChange={(event) => {
                          setManifestText(event.target.value);
                          setManifestStatus(null);
                        }}
                        spellCheck={false}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          role={
                            manifestStatus?.includes("失败")
                              ? "alert"
                              : "status"
                          }
                          aria-live="polite"
                          className={cx(
                            "text-[10px]",
                            manifestStatus?.includes("失败")
                              ? "text-red-300"
                              : themeClasses.textMuted,
                          )}
                        >
                          {manifestStatus || "Manifest 仅在验证并保存后生效"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void validateAndSaveManifest()}
                          className="h-8 rounded-[7px] bg-[var(--text-primary)] px-3 text-xs font-semibold text-[var(--canvas-bg)]"
                        >
                          <FileJson className="mr-1.5 inline h-3.5 w-3.5" />
                          验证并保存
                        </button>
                      </div>
                    </section>
                  </>
                ) : null}
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
                        disabled={
                          providerDraft.protocol === "custom-http-image-v1"
                        }
                        className="inline-flex items-center gap-1.5 px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/60"
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
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                              <ModelOptionIcon model={entry} />
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
      {providerPickerOpen
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm">
              <button
                type="button"
                aria-label="关闭协议选择"
                className="absolute inset-0 cursor-default"
                onClick={() => setProviderPickerOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                className="relative w-[min(30rem,calc(100vw-1.5rem))] rounded-[8px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] p-4 shadow-2xl"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    选择服务商协议
                  </h2>
                  <button
                    type="button"
                    aria-label="关闭"
                    title="关闭"
                    onClick={() => setProviderPickerOpen(false)}
                    className={`${themeClasses.iconButton} h-7 w-7 rounded-[6px]`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid gap-2">
                  {(
                    [
                      [
                        "openai-compatible",
                        "OpenAI Compatible",
                        "官方及大多数兼容接口，默认使用同步图片生成",
                      ],
                      ["dashscope", "阿里百炼", "使用内置 DashScope 受控协议"],
                      [
                        "custom-http-image-v1",
                        "自定义服务商",
                        "用 Manifest 适配特殊同步或异步图片接口",
                      ],
                    ] as const
                  ).map(([protocol, title, description]) => (
                    <button
                      key={protocol}
                      type="button"
                      onClick={() => createProvider(protocol)}
                      className="flex items-start gap-3 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-3 text-left transition hover:bg-[var(--control-bg-hover)]"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--accent-violet-soft)] text-[var(--text-primary)]">
                        <FileJson className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-[var(--text-primary)]">
                          {title}
                        </span>
                        <span className="mt-1 block text-[10px] leading-4 text-[var(--text-muted)]">
                          {description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
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
                          {MODEL_TABS.filter(
                            (tab) =>
                              providerDraft.protocol !==
                                "custom-http-image-v1" || tab.id === "image",
                          ).map((tab) => (
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
