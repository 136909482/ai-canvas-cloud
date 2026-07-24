import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Server } from "lucide-react";
import {
  getNodeModelIssueLabel,
  getSelectableModels,
  getSelectableProviderProfiles,
  NODE_MODEL_SELECTION_LABELS,
  type NodeModelSelection,
} from "@/features/settings/nodeModelSelection";
import type {
  ApiConfig,
  ModelCategory,
  ModelEntry,
  ProviderProfileConfig,
} from "@/types";
import { ModelOptionIcon } from "./GenerateNode/modelOptions";
import { InlineSelect, type InlineSelectOption } from "./InlineSelect";

const EMPTY_PROVIDER_VALUE = "__provider-empty__";
const EMPTY_MODEL_VALUE = "__model-empty__";

type NodeModelSelectorProps = {
  category: ModelCategory;
  config: ApiConfig;
  selection: NodeModelSelection;
  onSelectModel: (modelEntryId: string) => void;
  stopCanvasGesture: (event: SyntheticEvent) => void;
  providerAriaLabel: string;
  modelAriaLabel: string;
  className?: string;
  menuClassName?: string;
  renderModelIcon?: (model: ModelEntry) => ReactNode;
};

function getProviderOption(
  profile: ProviderProfileConfig,
  selectableProviderIds: Set<string>,
): InlineSelectOption {
  return {
    value: profile.id,
    label: profile.name,
    icon: <Server className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />,
    disabled: !selectableProviderIds.has(profile.id),
  };
}

export function NodeModelSelector({
  category,
  config,
  selection,
  onSelectModel,
  stopCanvasGesture,
  providerAriaLabel,
  modelAriaLabel,
  className = "",
  menuClassName = "min-w-[210px]",
  renderModelIcon,
}: NodeModelSelectorProps) {
  const selectableProfiles = useMemo(
    () => getSelectableProviderProfiles(config, category),
    [category, config],
  );
  const selectableProviderIds = useMemo(
    () => new Set(selectableProfiles.map((profile) => profile.id)),
    [selectableProfiles],
  );
  const [activeProviderId, setActiveProviderId] = useState(
    selection.selectedProvider?.id ?? "",
  );
  const didClearModelRef = useRef(false);
  const previousReference = useRef(selection.reference);

  useEffect(() => {
    if (previousReference.current === selection.reference) return;
    previousReference.current = selection.reference;

    if (selection.reference) {
      didClearModelRef.current = false;
      setActiveProviderId(selection.selectedProvider?.id ?? "");
      return;
    }

    if (!didClearModelRef.current) {
      setActiveProviderId("");
    }
  }, [selection.reference, selection.selectedProvider?.id]);

  const providerOptions = useMemo<InlineSelectOption[]>(() => {
    const profiles = [...selectableProfiles];
    if (
      selection.selectedProvider &&
      !profiles.some((profile) => profile.id === selection.selectedProvider?.id)
    ) {
      profiles.unshift(selection.selectedProvider);
    }

    if (profiles.length === 0) {
      return [
        {
          value: EMPTY_PROVIDER_VALUE,
          label: NODE_MODEL_SELECTION_LABELS.noAvailableProvider,
          disabled: true,
        },
      ];
    }

    return profiles.map((profile) =>
      getProviderOption(profile, selectableProviderIds),
    );
  }, [selectableProfiles, selectableProviderIds, selection.selectedProvider]);

  const selectableModels = useMemo(
    () =>
      activeProviderId
        ? getSelectableModels(config, category, activeProviderId)
        : [],
    [activeProviderId, category, config],
  );
  const modelWasCleared = didClearModelRef.current;
  const modelValue = modelWasCleared
    ? EMPTY_MODEL_VALUE
    : selection.reference || EMPTY_MODEL_VALUE;
  const modelOptions = useMemo<InlineSelectOption[]>(() => {
    const options: InlineSelectOption[] = [];
    const selectedModelIsShown = selectableModels.some(
      (model) => model.id === modelValue,
    );

    if (
      modelValue !== EMPTY_MODEL_VALUE &&
      !selectedModelIsShown &&
      !modelWasCleared
    ) {
      const issueLabel = getNodeModelIssueLabel(selection);
      options.push({
        value: modelValue,
        label: selection.selectedModel
          ? `${selection.selectedModel.displayName || selection.selectedModel.modelId} / ${issueLabel}`
          : issueLabel,
        disabled: true,
      });
    }

    options.push(
      ...selectableModels.map((model) => ({
        value: model.id,
        label: model.displayName || model.modelId,
        icon: renderModelIcon?.(model) ?? <ModelOptionIcon model={model} />,
      })),
    );

    if (options.length === 0) {
      options.push({
        value: EMPTY_MODEL_VALUE,
        label: activeProviderId
          ? NODE_MODEL_SELECTION_LABELS.noAvailableModel
          : NODE_MODEL_SELECTION_LABELS.noModel,
        disabled: true,
      });
    }

    return options;
  }, [
    activeProviderId,
    modelValue,
    modelWasCleared,
    selectableModels,
    selection,
    renderModelIcon,
  ]);

  const providerPickerDisabled =
    providerOptions.length === 1 && providerOptions[0]?.disabled === true;
  const modelPickerDisabled =
    !activeProviderId ||
    (modelOptions.length === 1 && modelOptions[0]?.disabled === true);

  return (
    <div className={`grid min-w-0 grid-cols-2 gap-1.5 ${className}`}>
      <InlineSelect
        value={activeProviderId || EMPTY_PROVIDER_VALUE}
        options={providerOptions}
        ariaLabel={providerAriaLabel}
        disabled={providerPickerDisabled}
        onChange={(providerProfileId) => {
          didClearModelRef.current = true;
          setActiveProviderId(providerProfileId);
          if (selection.issue !== "unbound") onSelectModel("");
        }}
        stopCanvasGesture={stopCanvasGesture}
        menuClassName={menuClassName}
      />

      <InlineSelect
        value={modelValue}
        options={modelOptions}
        ariaLabel={modelAriaLabel}
        disabled={modelPickerDisabled}
        onChange={(modelEntryId) => {
          didClearModelRef.current = false;
          onSelectModel(modelEntryId);
        }}
        stopCanvasGesture={stopCanvasGesture}
        menuClassName={menuClassName}
      />
    </div>
  );
}
