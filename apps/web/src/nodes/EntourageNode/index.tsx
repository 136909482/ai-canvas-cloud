import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Handle, Position } from "@xyflow/react";
import {
  BrainCircuit,
  ChevronDown,
  CheckCircle2,
  Clock3,
  ImagePlus,
  Loader2,
  Paintbrush,
  Play,
  Sprout,
  Sparkles,
  SlidersHorizontal,
  Trees,
  Users,
  Wand2,
} from "lucide-react";
import { getCanvasNodeById } from "@/store/canvasConnectionSources";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { themeClasses } from "@/styles/themeClasses";
import { recordComponentRender } from "@/utils/performanceDiagnostics";
import {
  getNodeModelIssueLabel,
  getNodeModelSelection,
  getPreferredSelectableModelEntryId,
} from "@/features/settings/nodeModelSelection";
import { runEntourageFeature } from "@/features/entourage/execute";
import {
  ENTOURAGE_FEATURE_LABELS,
  isWholeImageEntourageFeature,
} from "@/features/entourage/planning";
import type { AppNodeProps, EntourageFeature } from "@/types";
import { useShallow } from "zustand/react/shallow";
import { NodeDeleteButton, NodeHeader, NodeResizerPreset } from "../nodeShell";
import { NodeModelSelector } from "../NodeModelSelector";
import { getNodeShellClassName } from "../nodeShellClassName";
import { areNodeContentPropsEqual } from "../nodePropComparators";
import {
  RatioPreview,
  SettingsSection,
  SettingsSegment,
} from "../GenerateNode/modelOptions";
import {
  RATIOS,
  RESOLUTIONS,
  getRatioLabel,
  getResolutionLabel,
} from "../GenerateNode/modelSettings";

type EntourageNodeProps = AppNodeProps<"entourageNode">;

const UI_TEXT = {
  deleteNode: "删除 AI 配景节点",
  title: "AI 配景",
  noBaseImage: "连接一张外景图",
  awaitingImage: "等待图像输入",
  connected: "外景图已接入",
  modelConfig: "模型配置",
  feature: "配景类型",
  plannerModel: "规划模型",
  editModel: "重绘模型",
  outputSettings: "输出设置",
  chooseRatio: "选择重绘比例",
  chooseResolution: "选择重绘分辨率",
  run: "开始生成",
  queued: "已进入生成队列",
  generating: "AI 正在添加配景",
  done: "配景已添加",
  retry: "重试",
  idleHint: "准备就绪",
  placementsSuffix: "个配景",
} as const;

const FEATURES: Array<{
  id: EntourageFeature;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "rich",
    label: ENTOURAGE_FEATURE_LABELS.rich,
    icon: <Trees className="h-3.5 w-3.5" />,
  },
  {
    id: "plants",
    label: ENTOURAGE_FEATURE_LABELS.plants,
    icon: <Sprout className="h-3.5 w-3.5" />,
  },
  {
    id: "people",
    label: ENTOURAGE_FEATURE_LABELS.people,
    icon: <Users className="h-3.5 w-3.5" />,
  },
];

export const EntourageNode = memo(function EntourageNode({
  id,
  data,
  selected,
}: EntourageNodeProps) {
  recordComponentRender("EntourageNode");
  const baseSourceNodeId =
    typeof data.sourceImageNodeId === "string" ? data.sourceImageNodeId : null;
  const hasBaseImage = useCanvasStore(
    useShallow((state) => {
      const candidate = getCanvasNodeById(state.nodes, baseSourceNodeId);
      const node =
        candidate?.type === "imageNode" ||
        candidate?.type === "generatedPreviewNode" ||
        candidate?.type === "testImageNode" ||
        candidate?.type === "entourageNode"
          ? candidate
          : null;
      return (
        Boolean(node) &&
        typeof node?.data?.imageUrl === "string" &&
        Boolean(node.data.imageUrl)
      );
    }),
  );
  const { updateNodeData, deleteNode } = useCanvasStore(
    useShallow((state) => ({
      updateNodeData: state.updateNodeData,
      deleteNode: state.deleteNode,
    })),
  );
  const runTracked = useHistoryStore((s) => s.runTracked);
  const settingsConfig = useSettingsStore((s) => s.config);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const bindLocalModelReference = useSettingsStore(
    (s) => s.bindLocalModelReference,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const plannerModelSelection = useMemo(
    () =>
      getNodeModelSelection(settingsConfig, {
        category: "chat",
        reference: data.plannerModel,
      }),
    [data.plannerModel, settingsConfig],
  );
  const imageModelSelection = useMemo(
    () =>
      getNodeModelSelection(settingsConfig, {
        category: "image",
        reference: data.model,
      }),
    [data.model, settingsConfig],
  );
  const hasSelectableChatModels = useMemo(
    () => Boolean(getPreferredSelectableModelEntryId(settingsConfig, "chat")),
    [settingsConfig],
  );
  const hasSelectableImageModels = useMemo(
    () => Boolean(getPreferredSelectableModelEntryId(settingsConfig, "image")),
    [settingsConfig],
  );

  const feature: EntourageFeature =
    data.feature === "rich" || data.feature === "people"
      ? data.feature
      : "plants";
  const isQueued = data.status === "queued";
  const isGenerating = data.status === "generating";
  const isBusy = isQueued || isGenerating;
  const isError = data.status === "error";
  const isDone = data.status === "done";
  const placementCount = Array.isArray(data.placements)
    ? data.placements.length
    : 0;
  const ratio = RATIOS.includes(data.ratio) ? data.ratio : RATIOS[0];
  const resolution = RESOLUTIONS.includes(data.resolution)
    ? data.resolution
    : RESOLUTIONS[0];
  const outputSettingsSummary = `${getRatioLabel(ratio)} / ${getResolutionLabel(resolution)}`;
  const stopCanvasGesture = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const selectPlannerModel = (modelId: string) => {
    runTracked(() => {
      if (
        plannerModelSelection.issue === "unbound" &&
        modelId !== data.plannerModel &&
        !bindLocalModelReference(data.plannerModel, modelId)
      )
        return;
      updateNodeData(id, { plannerModel: modelId, errorMsg: "" });
      if (modelId) setDefaultModel(modelId);
    });
  };

  const selectImageModel = (modelId: string) => {
    runTracked(() => {
      if (
        imageModelSelection.issue === "unbound" &&
        modelId !== data.model &&
        !bindLocalModelReference(data.model, modelId)
      )
        return;
      updateNodeData(id, { model: modelId, errorMsg: "" });
      if (modelId) setDefaultModel(modelId);
    });
  };

  const selectFeature = (nextFeature: EntourageFeature) => {
    if (nextFeature === feature || isBusy) return;
    runTracked(() =>
      updateNodeData(id, { feature: nextFeature, errorMsg: "" }),
    );
  };

  useEffect(() => {
    if (!settingsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [settingsOpen]);

  const handleRun = () => {
    if (isBusy || !hasBaseImage) return;
    void runEntourageFeature(id, feature);
  };

  const placementSummary =
    !isWholeImageEntourageFeature(feature) && placementCount > 0
      ? `人物规划 ${placementCount} ${UI_TEXT.placementsSuffix}`
      : null;
  const featureLabel = ENTOURAGE_FEATURE_LABELS[feature];

  return (
    <div
      data-testid={`node-${id}`}
      className={getNodeShellClassName({ selected })}
    >
      <NodeResizerPreset
        selected={selected}
        minWidth={340}
        minHeight={300}
        maxWidth={640}
        maxHeight={560}
        hideVisuals
      />

      <NodeDeleteButton
        id={id}
        selected={selected}
        ariaLabel={UI_TEXT.deleteNode}
        onDelete={() => runTracked(() => deleteNode(id))}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="base"
        className="handle-orb-anchor !w-[18px] !h-[18px] !rounded-full !border-0 !bg-transparent !p-0"
        style={{ top: "50%" }}
      >
        <span className="handle-orb handle-orb--target">
          <span className="handle-orb__glow" />
          <span className="handle-orb__ring" />
          <span className="handle-orb__dot" />
        </span>
      </Handle>

      <Handle
        type="source"
        position={Position.Right}
        id="image"
        className="handle-orb-anchor !w-[18px] !h-[18px] !rounded-full !border-0 !bg-transparent !p-0"
      >
        <span className="handle-orb handle-orb--source">
          <span className="handle-orb__glow" />
          <span className="handle-orb__ring" />
          <span className="handle-orb__dot" />
        </span>
      </Handle>

      <NodeHeader
        icon={<Trees className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
        title={UI_TEXT.title}
        right={
          <span
            className={`ml-auto ${themeClasses.nodeBadge} ${themeClasses.nodeBadgeViolet}`}
          >
            <Wand2 className="h-3 w-3" />
            {featureLabel}
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        {!hasBaseImage ? (
          <div className="node-drag-handle relative flex flex-1 cursor-default flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--control-bg)] px-6 text-center select-none active:cursor-grabbing">
            <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent-violet-muted),transparent)]" />
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--accent-violet-muted)] bg-[var(--accent-violet-soft)] text-[var(--accent-violet-strong)] shadow-[0_8px_24px_var(--accent-violet-glow)]">
              <ImagePlus className="h-5 w-5" />
            </div>
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              {UI_TEXT.noBaseImage}
            </p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--node-bg)] px-2 py-1 text-[9px] font-medium text-[var(--text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              {UI_TEXT.awaitingImage}
            </span>
          </div>
        ) : (
          <>
            <div className="flex h-6 items-center justify-between rounded-lg border border-emerald-400/15 bg-emerald-400/[0.055] px-2">
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                {UI_TEXT.connected}
              </span>
              <span className="text-[9px] font-medium text-[var(--text-muted)]">
                INPUT 01
              </span>
            </div>

            <section className="relative rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)] p-1.5">
              <div className="mb-1 flex items-center justify-between gap-2 px-1 py-0.5">
                <span className="flex items-center gap-1.5 text-[9px] font-semibold text-[var(--text-muted)]">
                  <Sparkles className="h-3 w-3 text-[var(--accent-violet-strong)]" />
                  {UI_TEXT.modelConfig}
                </span>
                <div ref={settingsRef} className="relative">
                  <button
                    type="button"
                    className={`nodrag nopan flex h-5 items-center gap-1 rounded-md border px-1.5 text-[9px] font-medium transition-colors ${
                      settingsOpen
                        ? "border-[var(--accent-violet-muted)] bg-[var(--accent-violet-soft)] text-[var(--text-primary)]"
                        : "border-[var(--border-subtle)] bg-[var(--node-bg)] text-[var(--text-secondary)] hover:border-[var(--accent-violet-muted)]"
                    }`}
                    aria-label={UI_TEXT.outputSettings}
                    aria-expanded={settingsOpen}
                    aria-haspopup="dialog"
                    title={outputSettingsSummary}
                    onPointerDown={stopCanvasGesture}
                    onMouseDown={stopCanvasGesture}
                    onClick={(event) => {
                      stopCanvasGesture(event);
                      setSettingsOpen((current) => !current);
                    }}
                  >
                    <SlidersHorizontal className="h-3 w-3 text-[var(--accent-violet-strong)]" />
                    <span>{outputSettingsSummary}</span>
                    <ChevronDown
                      className={`h-3 w-3 text-[var(--text-muted)] transition-transform ${settingsOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {settingsOpen ? (
                    <div
                      className={`nodrag nopan absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden p-3 ${themeClasses.strongPanel}`}
                      role="dialog"
                      aria-label={UI_TEXT.outputSettings}
                      onPointerDown={stopCanvasGesture}
                      onMouseDown={stopCanvasGesture}
                      onClick={stopCanvasGesture}
                    >
                      <div className="space-y-3">
                        <SettingsSection title="比例">
                          <SettingsSegment
                            value={ratio}
                            options={RATIOS}
                            ariaLabel={UI_TEXT.chooseRatio}
                            onChange={(value) =>
                              runTracked(() =>
                                updateNodeData(id, { ratio: value }),
                              )
                            }
                            groupClassName="!h-auto !grid-flow-row grid-cols-4 !auto-cols-auto gap-x-1 gap-y-2 rounded-[9px] bg-[var(--control-bg)] p-2 shadow-none"
                            buttonClassName="h-12 flex-col gap-1 rounded-[7px] px-1 py-1 text-[10px] leading-none"
                            gridSlider={{
                              columns: 4,
                              rowHeightRem: 3,
                              columnGapRem: 0.25,
                              rowGapRem: 0.5,
                              insetRem: 0.5,
                            }}
                            renderOption={(value) => (
                              <>
                                <RatioPreview ratio={value} />
                                {getRatioLabel(value)}
                              </>
                            )}
                          />
                        </SettingsSection>

                        <SettingsSection title="分辨率">
                          <SettingsSegment
                            value={resolution}
                            options={RESOLUTIONS}
                            ariaLabel={UI_TEXT.chooseResolution}
                            onChange={(value) =>
                              runTracked(() =>
                                updateNodeData(id, { resolution: value }),
                              )
                            }
                            groupClassName="h-10 rounded-[9px] bg-[var(--control-bg)] p-1 shadow-none"
                            buttonClassName="rounded-[7px] text-[11px]"
                            slider
                            renderOption={getResolutionLabel}
                          />
                        </SettingsSection>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-1.5">
                {!isWholeImageEntourageFeature(feature) ? (
                  <>
                    <span className="flex items-center gap-1.5 px-1 text-[10px] font-medium text-[var(--text-secondary)]">
                      <BrainCircuit className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      {UI_TEXT.plannerModel}
                    </span>
                    {hasSelectableChatModels ? (
                      <NodeModelSelector
                        category="chat"
                        config={settingsConfig}
                        selection={plannerModelSelection}
                        onSelectModel={selectPlannerModel}
                        stopCanvasGesture={stopCanvasGesture}
                        providerAriaLabel="选择规划服务商"
                        modelAriaLabel="选择规划模型和服务商"
                        className="min-w-0"
                        menuClassName="min-w-[220px]"
                        layout="grouped"
                      />
                    ) : (
                      <span className="min-w-0 rounded-md border border-dashed border-[var(--border-subtle)] bg-[var(--node-bg)] px-2 py-1.5 text-[10px] leading-4 text-amber-600 dark:text-amber-300">
                        {getNodeModelIssueLabel(plannerModelSelection) ||
                          "未配置 Chat 模型，请先在模型设置中启用"}
                      </span>
                    )}
                  </>
                ) : null}
                <span className="flex items-center gap-1.5 px-1 text-[10px] font-medium text-[var(--text-secondary)]">
                  <Paintbrush className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  {UI_TEXT.editModel}
                </span>
                {hasSelectableImageModels ? (
                  <NodeModelSelector
                    category="image"
                    config={settingsConfig}
                    selection={imageModelSelection}
                    onSelectModel={selectImageModel}
                    stopCanvasGesture={stopCanvasGesture}
                    providerAriaLabel="选择重绘服务商"
                    modelAriaLabel="选择重绘模型和服务商"
                    className="min-w-0"
                    menuClassName="min-w-[220px]"
                    layout="grouped"
                  />
                ) : (
                  <span className="min-w-0 rounded-md border border-dashed border-[var(--border-subtle)] bg-[var(--node-bg)] px-2 py-1.5 text-[10px] leading-4 text-amber-600 dark:text-amber-300">
                    {getNodeModelIssueLabel(imageModelSelection) ||
                      "未配置图片模型，请先在模型设置中启用"}
                  </span>
                )}
              </div>
            </section>

            <section>
              <div className="mb-1 px-1 text-[9px] font-semibold text-[var(--text-muted)]">
                {UI_TEXT.feature}
              </div>
              <div className="nodrag nopan grid h-10 grid-cols-3 gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)] p-1">
                {FEATURES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => selectFeature(entry.id)}
                    disabled={isBusy}
                    className={`nodrag nopan flex min-w-0 items-center justify-center gap-2.5 rounded-md px-2.5 text-center text-xs font-semibold transition-all ${
                      feature === entry.id
                        ? "bg-[var(--accent-violet-soft)] text-[var(--accent-violet-strong)] shadow-[inset_0_0_0_1px_var(--accent-violet-muted)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]"
                    }`}
                    aria-pressed={feature === entry.id}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--node-bg)] shadow-[inset_0_0_0_1px_var(--border-subtle)]">
                      {entry.icon}
                    </span>
                    <span className="min-w-0 truncate">{entry.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <div className="mt-auto flex min-h-8 items-center gap-1.5 border-t border-[var(--border-subtle)] pt-1.5">
              <span
                className={`min-w-0 flex-1 px-0.5 text-[10px] leading-relaxed ${themeClasses.textSecondary}`}
              >
                {isBusy ? (
                  <span className="flex items-center gap-1.5">
                    {isQueued ? (
                      <Clock3 className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
                    )}
                    <span className={themeClasses.nodeWarningText}>
                      {isQueued ? UI_TEXT.queued : UI_TEXT.generating}
                    </span>
                    {placementSummary ? (
                      <span className="text-[var(--text-muted)]">
                        · {placementSummary}
                      </span>
                    ) : null}
                  </span>
                ) : isDone ? (
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-300">
                    <Wand2 className="h-3.5 w-3.5 shrink-0" />
                    {UI_TEXT.done}
                    {placementSummary ? ` · ${placementSummary}` : ""}
                  </span>
                ) : isError ? (
                  <span
                    className={`block min-w-0 truncate ${themeClasses.nodeErrorText}`}
                    title={data.errorMsg || UI_TEXT.retry}
                  >
                    {data.errorMsg || UI_TEXT.retry}
                  </span>
                ) : (
                  <span className={themeClasses.textMuted}>
                    {UI_TEXT.idleHint}
                  </span>
                )}
              </span>

              <button
                type="button"
                onClick={handleRun}
                disabled={isBusy}
                data-testid={`run-entourage-${id}`}
                className={`${themeClasses.nodePrimaryButton} nodrag nopan relative h-8 min-w-[100px] shrink-0 gap-1.5 px-3 text-[10px] font-semibold shadow-[0_8px_20px_var(--accent-violet-glow)] duration-200`}
                aria-label={
                  isError
                    ? UI_TEXT.retry
                    : isBusy
                      ? isQueued
                        ? UI_TEXT.queued
                        : UI_TEXT.generating
                      : UI_TEXT.run
                }
                title={isError ? UI_TEXT.retry : UI_TEXT.run}
              >
                {isBusy ? (
                  isQueued ? (
                    <Clock3 className="h-3.5 w-3.5" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    {isError ? UI_TEXT.retry : UI_TEXT.run}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}, areNodeContentPropsEqual);
