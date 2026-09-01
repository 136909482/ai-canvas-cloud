import {
  isLocalModelReference,
  resolveLocalModelReference,
} from "./localModelReferences";
import {
  resolveRuntimeModelConfig,
  type ProviderConfigDiagnostic,
} from "./providerConfig";
import type {
  ApiConfig,
  ModelCategory,
  ModelEntry,
  ProviderProfileConfig,
} from "@/types";
import { isOfficialModelReference } from "@/features/officialGeneration/modelReference";

export type NodeModelSelectionIssue =
  "none" | "unbound" | "deleted" | "unavailable";

export interface NodeModelSelection {
  reference: string;
  modelEntryId: string | null;
  selectedModel: ModelEntry | null;
  selectedProvider: ProviderProfileConfig | null;
  diagnostic: ProviderConfigDiagnostic | null;
  issue: NodeModelSelectionIssue;
  canExecute: boolean;
}

export interface SelectableModelGroup {
  modelId: string;
  models: ModelEntry[];
}

export const NODE_MODEL_SELECTION_LABELS = {
  noProvider: "选择服务商",
  noModel: "选择模型",
  noAvailableProvider: "没有可用服务商",
  noAvailableModel: "当前服务商没有可用模型",
  unbound: "未绑定",
  deleted: "已删除",
  disabled: "已停用",
  missing: "上游未找到",
  providerDisabled: "服务商已停用",
  credentialsInvalid: "凭据无效",
} as const;

function normalizeReference(reference: unknown) {
  return typeof reference === "string" ? reference.trim() : "";
}

export function resolveNodeModelEntryId(
  config: Pick<ApiConfig, "localModelBindings">,
  reference: unknown,
) {
  const normalizedReference = normalizeReference(reference);
  if (!normalizedReference) return null;
  return isLocalModelReference(normalizedReference)
    ? resolveLocalModelReference(config.localModelBindings, normalizedReference)
    : normalizedReference;
}

export function getNodeModelSelection(
  config: ApiConfig,
  input: { category: ModelCategory; reference: unknown },
): NodeModelSelection {
  const reference = normalizeReference(input.reference);
  const modelEntryId = resolveNodeModelEntryId(config, reference);
  const hasUnboundReference =
    Boolean(reference) && isLocalModelReference(reference) && !modelEntryId;
  const selectedModel = modelEntryId
    ? (config.modelEntries.find((entry) => entry.id === modelEntryId) ?? null)
    : null;
  const selectedProvider = selectedModel?.providerProfileId
    ? (config.providerProfiles.find(
        (profile) => profile.id === selectedModel.providerProfileId,
      ) ?? null)
    : null;

  if (reference && isOfficialModelReference(reference)) {
    return {
      reference,
      modelEntryId: null,
      selectedModel: null,
      selectedProvider: null,
      diagnostic: null,
      issue: "none",
      canExecute: true,
    };
  }

  if (!reference) {
    return {
      reference,
      modelEntryId: null,
      selectedModel: null,
      selectedProvider: null,
      diagnostic: null,
      issue: "none",
      canExecute: false,
    };
  }

  if (hasUnboundReference) {
    return {
      reference,
      modelEntryId: null,
      selectedModel: null,
      selectedProvider: null,
      diagnostic: null,
      issue: "unbound",
      canExecute: false,
    };
  }

  if (!modelEntryId || !selectedModel) {
    return {
      reference,
      modelEntryId,
      selectedModel: null,
      selectedProvider: null,
      diagnostic: null,
      issue: "deleted",
      canExecute: false,
    };
  }

  const resolution = resolveRuntimeModelConfig(config, {
    modelEntryId,
    category: input.category,
    requireCredentials: true,
  });

  if (!resolution.ok) {
    return {
      reference,
      modelEntryId,
      selectedModel,
      selectedProvider,
      diagnostic: resolution.diagnostic,
      issue:
        resolution.diagnostic.code === "modelMissing"
          ? "deleted"
          : "unavailable",
      canExecute: false,
    };
  }

  return {
    reference,
    modelEntryId,
    selectedModel,
    selectedProvider,
    diagnostic: null,
    issue: "none",
    canExecute: true,
  };
}

export function getNodeModelIssueLabel(selection: NodeModelSelection) {
  if (selection.issue === "unbound") return NODE_MODEL_SELECTION_LABELS.unbound;
  if (selection.issue === "deleted") return NODE_MODEL_SELECTION_LABELS.deleted;

  switch (selection.diagnostic?.code) {
    case "modelDisabled":
      return NODE_MODEL_SELECTION_LABELS.disabled;
    case "modelMissingUpstream":
      return NODE_MODEL_SELECTION_LABELS.missing;
    case "providerProfileDisabled":
      return NODE_MODEL_SELECTION_LABELS.providerDisabled;
    case "emptyApiKey":
    case "emptyApiUrl":
    case "invalidApiUrl":
    case "insecureApiUrl":
    case "apiUrlCredentials":
    case "apiUrlFragment":
      return NODE_MODEL_SELECTION_LABELS.credentialsInvalid;
    default:
      return selection.diagnostic?.message ?? "";
  }
}

export function getSelectableModels(
  config: ApiConfig,
  category: ModelCategory,
  providerProfileId: string,
) {
  return config.modelEntries.filter((entry) => {
    if (
      entry.category !== category ||
      entry.providerProfileId !== providerProfileId
    ) {
      return false;
    }

    return resolveRuntimeModelConfig(config, {
      modelEntryId: entry.id,
      category,
      requireCredentials: true,
    }).ok;
  });
}

export function getSelectableProviderProfiles(
  config: ApiConfig,
  category: ModelCategory,
) {
  return config.providerProfiles.filter(
    (profile) => getSelectableModels(config, category, profile.id).length > 0,
  );
}

export function getSelectableModelGroups(
  config: ApiConfig,
  category: ModelCategory,
) {
  const groups = new Map<string, SelectableModelGroup>();

  for (const profile of getSelectableProviderProfiles(config, category)) {
    for (const model of getSelectableModels(config, category, profile.id)) {
      const modelId = model.modelId.trim() || model.id;
      const group = groups.get(modelId);
      if (group) {
        group.models.push(model);
      } else {
        groups.set(modelId, { modelId, models: [model] });
      }
    }
  }

  return [...groups.values()];
}

export function getPreferredSelectableModelEntryId(
  config: ApiConfig,
  category: ModelCategory,
) {
  const selectableModels = getSelectableModelGroups(config, category).flatMap(
    (group) => group.models,
  );

  const preferredModelEntryId =
    config.lastUsedModelEntryIds?.[category] ?? config.defaultModelEntryId;

  if (
    preferredModelEntryId &&
    selectableModels.some((model) => model.id === preferredModelEntryId)
  ) {
    return preferredModelEntryId;
  }

  return selectableModels[0]?.id ?? "";
}
