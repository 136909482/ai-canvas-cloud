import { memo, useMemo, useState, type SyntheticEvent } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  ChevronDown,
  Clock3,
  Home,
  ImageIcon,
  Loader2,
  Play,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { enqueueGenerateTask } from "@/features/generateQueue/orchestrator";
import {
  compileInteriorDesignPrompt,
  getInteriorProviderRatio,
  normalizeInteriorDesignConfig,
  parseInteriorMaterialDefinition,
} from "@/features/interiorDesign/compiler";
import {
  APERTURE_OPTIONS,
  ASPECT_RATIO_OPTIONS,
  CAMERA_OPTIONS,
  COLOR_GRADING_OPTIONS,
  COLOR_TEMPERATURE_OPTIONS,
  CONVERSION_GOAL_OPTIONS,
  CURTAIN_OPTIONS,
  DESIGN_STYLE_OPTIONS,
  EXTERIOR_VIEW_OPTIONS,
  FOCAL_LENGTH_OPTIONS,
  GEOMETRY_OPTIONS,
  INTERIOR_LIGHT_OPTIONS,
  INTERIOR_PRESETS,
  ISO_OPTIONS,
  LOCATION_OPTIONS,
  MATERIAL_OPTIONS,
  OBJECT_OPTIONS,
  OCCUPANT_OPTIONS,
  PROMPT_RESOLUTION_OPTIONS,
  SEASON_OPTIONS,
  SHUTTER_OPTIONS,
  SOURCE_SOFTWARE_OPTIONS,
  SPACE_TYPE_OPTIONS,
  SUNLIGHT_OPTIONS,
  TECHNIQUE_OPTIONS,
  TIME_OPTIONS,
  TONAL_QUALITY_OPTIONS,
  WEATHER_OPTIONS,
  applyInteriorPreset,
  findInteriorOption,
} from "@/features/interiorDesign/catalog";
import type {
  InteriorDesignConfigV1,
  InteriorOption,
} from "@/features/interiorDesign/types";
import {
  getNodeModelIssueLabel,
  getNodeModelSelection,
} from "@/features/settings/nodeModelSelection";
import {
  makeSelectInteriorDesignSourceNode,
  useCanvasStore,
} from "@/store/useCanvasStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import { getWorkspaceAssetRelativePath } from "@/utils/workspaceImageAsset";
import type { AppNodeProps } from "@/types";
import { themeClasses } from "@/styles/themeClasses";
import { NodeModelSelector } from "../NodeModelSelector";
import { NodeDeleteButton, NodeHeader, NodeResizerPreset } from "../nodeShell";
import { getNodeShellClassName } from "../nodeShellClassName";

type Props = AppNodeProps<"interiorDesignNode">;

const controlClass = `nodrag nowheel h-9 w-full px-2.5 text-[11px] ${themeClasses.nodeInput}`;
const labelClass =
  "space-y-1 text-[10px] font-medium leading-none text-[var(--text-muted)]";

function OptionSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: InteriorOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={labelClass}>
      <span>{label}</span>
      <select
        className={controlClass}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="group/section border-t border-[var(--border-subtle)]"
      open={defaultOpen}
    >
      <summary className="nodrag nopan flex h-9 cursor-pointer list-none items-center gap-2 px-0.5 select-none">
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-open/section:rotate-180 group-open/section:text-[var(--accent-violet-strong)]" />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] group-open/section:text-[var(--text-primary)]">
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-[var(--text-muted)]">
          {summary}
        </span>
      </summary>
      <div className="grid grid-cols-2 gap-2 pb-2.5">{children}</div>
    </details>
  );
}

export const InteriorDesignNode = memo(function InteriorDesignNode({
  id,
  data,
  selected,
}: Props) {
  const { updateNodeData, deleteNode } = useCanvasStore(
    useShallow((state) => ({
      updateNodeData: state.updateNodeData,
      deleteNode: state.deleteNode,
    })),
  );
  const sourceNode = useCanvasStore(
    useMemo(() => makeSelectInteriorDesignSourceNode(id), [id]),
  );
  const config = data.config;
  const settingsConfig = useSettingsStore((state) => state.config);
  const setDefaultModel = useSettingsStore((state) => state.setDefaultModel);
  const bindLocalModelReference = useSettingsStore(
    (state) => state.bindLocalModelReference,
  );
  const projectId = useProjectStore((state) => state.activeProjectId);
  const activeTaskCount = useTaskQueueStore(
    (state) =>
      state.tasks.filter(
        (task) =>
          task.sourceNodeId === id &&
          (task.status === "queued" || task.status === "running"),
      ).length,
  );
  const [materialDraft, setMaterialDraft] = useState(() =>
    typeof config.constraints.materialDefinition === "string"
      ? config.constraints.materialDefinition
      : JSON.stringify(config.constraints.materialDefinition, null, 2),
  );
  const [materialError, setMaterialError] = useState("");
  const modelSelection = useMemo(
    () =>
      getNodeModelSelection(settingsConfig, {
        category: "image",
        reference: data.model,
      }),
    [data.model, settingsConfig],
  );

  const persistConfig = (next: InteriorDesignConfigV1) => {
    const normalized = normalizeInteriorDesignConfig(next);
    updateNodeData(id, {
      config: normalized.config,
      compiledPrompt: compileInteriorDesignPrompt(normalized.config),
      ratio: getInteriorProviderRatio(normalized.config.output.aspectRatio),
      errorMsg: "",
    });
  };

  const patchConfig = (patch: Partial<InteriorDesignConfigV1>) =>
    persistConfig({ ...config, ...patch });
  const patchScene = (patch: Partial<InteriorDesignConfigV1["scene"]>) =>
    patchConfig({ scene: { ...config.scene, ...patch } });
  const patchLighting = (patch: Partial<InteriorDesignConfigV1["lighting"]>) =>
    patchConfig({ lighting: { ...config.lighting, ...patch } });
  const patchPhotography = (
    patch: Partial<InteriorDesignConfigV1["photography"]>,
  ) => patchConfig({ photography: { ...config.photography, ...patch } });
  const patchConstraints = (
    patch: Partial<InteriorDesignConfigV1["constraints"]>,
  ) => patchConfig({ constraints: { ...config.constraints, ...patch } });
  const patchOutput = (patch: Partial<InteriorDesignConfigV1["output"]>) =>
    patchConfig({ output: { ...config.output, ...patch } });

  const choosePreset = (presetId: string) => {
    const preset = INTERIOR_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const next = applyInteriorPreset(config, preset.id);
    persistConfig(next);
    setMaterialDraft(
      typeof next.constraints.materialDefinition === "string"
        ? next.constraints.materialDefinition
        : JSON.stringify(next.constraints.materialDefinition, null, 2),
    );
    setMaterialError("");
  };

  const selectModel = (modelId: string) => {
    if (
      modelSelection.issue === "unbound" &&
      modelId !== data.model &&
      !bindLocalModelReference(data.model, modelId)
    )
      return;
    updateNodeData(id, { model: modelId, errorMsg: "" });
    if (modelId) setDefaultModel(modelId);
  };

  const validation = normalizeInteriorDesignConfig(config);
  const disabledReasons = [
    !sourceNode ? "请连接一张图片" : "",
    !modelSelection.canExecute
      ? getNodeModelIssueLabel(modelSelection) || "请选择可执行的图片模型"
      : "",
    ...validation.errors,
    materialError,
  ].filter(Boolean);
  const isBusy = data.status === "queued" || data.status === "generating";

  const enqueue = () => {
    if (!sourceNode || disabledReasons.length > 0) return;
    const prompt = compileInteriorDesignPrompt(validation.config);
    const taskId = enqueueGenerateTask({
      projectId,
      sourceNodeId: id,
      prompt,
      model: modelSelection.modelEntryId ?? data.model,
      ratio: getInteriorProviderRatio(validation.config.output.aspectRatio),
      resolution: data.resolution,
      operationType: "image-to-image",
      referenceImages: [
        {
          sourceNodeId: sourceNode.id,
          imageUrl: sourceNode.data.imageUrl as string,
          assetRelativePath:
            getWorkspaceAssetRelativePath(sourceNode.data.imageAsset) ?? null,
        },
      ],
    });
    if (!taskId) {
      updateNodeData(id, { status: "error", errorMsg: "生成任务创建失败" });
    }
  };

  const stopCanvasGesture = (event: SyntheticEvent) => event.stopPropagation();
  const isEnclosed = config.scene.exteriorView === "enclosed";
  const sourceLabel =
    config.sourceSoftware === "custom"
      ? config.customSourceSoftware || "其他来源"
      : findInteriorOption(SOURCE_SOFTWARE_OPTIONS, config.sourceSoftware)
          .label;
  const targetLabel = findInteriorOption(
    CONVERSION_GOAL_OPTIONS,
    config.conversionGoal,
  ).label;

  return (
    <div className={getNodeShellClassName({ selected })}>
      <NodeResizerPreset
        selected={selected}
        minWidth={520}
        minHeight={520}
        hideVisuals
      />
      <NodeDeleteButton
        id={id}
        selected={selected}
        ariaLabel="删除室内设计节点"
        onDelete={() => deleteNode(id)}
      />
      <NodeHeader
        icon={<Home className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
        title="室内设计"
        right={
          <span
            className={`${themeClasses.nodeBadge} ${themeClasses.nodeBadgeViolet}`}
          >
            <ImageIcon className="h-3 w-3" />
            图生图
          </span>
        }
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        className="handle-orb-anchor !h-[18px] !w-[18px] !rounded-full !border-0 !bg-transparent !p-0"
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
        className="handle-orb-anchor !h-[18px] !w-[18px] !rounded-full !border-0 !bg-transparent !p-0"
      >
        <span className="handle-orb handle-orb--source">
          <span className="handle-orb__glow" />
          <span className="handle-orb__ring" />
          <span className="handle-orb__dot" />
        </span>
      </Handle>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2.5">
        <div className="nowheel min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex items-center gap-2 pb-2.5">
            <div
              className={`h-12 w-16 shrink-0 overflow-hidden ${themeClasses.nodeAssetThumb}`}
            >
              {sourceNode ? (
                <img
                  src={sourceNode.data.imageUrl as string}
                  alt="室内设计主图"
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
                  <ImageIcon className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                <span className="truncate">{sourceLabel}</span>
                <span className="text-[var(--text-muted)]">→</span>
                <span className="truncate">{targetLabel}</span>
              </div>
              <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                {sourceNode ? "已连接主图" : "从左侧连接一张主图"}
              </p>
            </div>
            <span
              className={`${themeClasses.nodeBadge} shrink-0 border-[var(--border-subtle)] bg-[var(--control-bg)] text-[var(--text-muted)] normal-case tracking-normal`}
            >
              {INTERIOR_PRESETS.find((item) => item.id === config.presetId)
                ?.label ?? "自定义"}
            </span>
          </div>

          <Section
            title="任务指令"
            summary={
              INTERIOR_PRESETS.find((p) => p.id === config.presetId)?.label ??
              "自定义"
            }
            defaultOpen
          >
            <OptionSelect
              label="光影预设"
              value={config.presetId}
              options={INTERIOR_PRESETS.map((p) => ({
                id: p.id,
                label: p.label,
                prompt: p.description,
              }))}
              onChange={choosePreset}
            />
            <OptionSelect
              label="来源类型"
              value={config.sourceSoftware}
              options={SOURCE_SOFTWARE_OPTIONS}
              onChange={(sourceSoftware) =>
                patchConfig({
                  sourceSoftware:
                    sourceSoftware as InteriorDesignConfigV1["sourceSoftware"],
                })
              }
            />
            {config.sourceSoftware === "custom" ? (
              <label className={`${labelClass} col-span-2`}>
                <span>来源名称</span>
                <input
                  className={controlClass}
                  value={config.customSourceSoftware}
                  maxLength={80}
                  onChange={(event) =>
                    patchConfig({ customSourceSoftware: event.target.value })
                  }
                />
              </label>
            ) : null}
            <div className="col-span-2">
              <OptionSelect
                label="转换目标"
                value={config.conversionGoal}
                options={CONVERSION_GOAL_OPTIONS}
                onChange={(conversionGoal) =>
                  patchConfig({
                    conversionGoal:
                      conversionGoal as InteriorDesignConfigV1["conversionGoal"],
                  })
                }
              />
            </div>
          </Section>

          <Section
            title="场景类型"
            summary={`${findInteriorOption(SPACE_TYPE_OPTIONS, config.scene.spaceType).label} / ${findInteriorOption(DESIGN_STYLE_OPTIONS, config.scene.designStyle).label}`}
            defaultOpen
          >
            <OptionSelect
              label="空间类型"
              value={config.scene.spaceType}
              options={SPACE_TYPE_OPTIONS}
              onChange={(spaceType) => patchScene({ spaceType })}
            />
            <OptionSelect
              label="设计风格"
              value={config.scene.designStyle}
              options={DESIGN_STYLE_OPTIONS}
              onChange={(designStyle) => patchScene({ designStyle })}
            />
            <OptionSelect
              label="外景类型"
              value={config.scene.exteriorView}
              options={EXTERIOR_VIEW_OPTIONS}
              disabled={isEnclosed}
              onChange={(exteriorView) => patchScene({ exteriorView })}
            />
            <OptionSelect
              label="地点"
              value={config.scene.location}
              options={LOCATION_OPTIONS}
              disabled={isEnclosed}
              onChange={(location) => patchScene({ location })}
            />
          </Section>

          <Section
            title="光影氛围"
            summary={`${findInteriorOption(TIME_OPTIONS, config.lighting.timeOfDay).label} / ${findInteriorOption(INTERIOR_LIGHT_OPTIONS, config.lighting.interiorLight).label}`}
          >
            <OptionSelect
              label="季节"
              value={config.lighting.season}
              options={SEASON_OPTIONS}
              onChange={(season) => patchLighting({ season })}
            />
            <OptionSelect
              label="天气"
              value={config.lighting.weather}
              options={WEATHER_OPTIONS}
              onChange={(weather) => patchLighting({ weather })}
            />
            <OptionSelect
              label="时间"
              value={config.lighting.timeOfDay}
              options={TIME_OPTIONS}
              onChange={(timeOfDay) => patchLighting({ timeOfDay })}
            />
            <OptionSelect
              label="窗帘"
              value={config.lighting.curtainType}
              options={CURTAIN_OPTIONS}
              disabled={isEnclosed}
              onChange={(curtainType) => patchLighting({ curtainType })}
            />
            <label className={`${labelClass} flex items-center gap-2 pt-4`}>
              <input
                className="nodrag"
                type="checkbox"
                checked={config.lighting.lightEntryEnabled}
                disabled={isEnclosed}
                onChange={(event) =>
                  patchLighting({ lightEntryEnabled: event.target.checked })
                }
              />
              <span>允许自然进光</span>
            </label>
            <OptionSelect
              label="太阳光影"
              value={config.lighting.sunlightEffect}
              options={SUNLIGHT_OPTIONS}
              disabled={!config.lighting.lightEntryEnabled}
              onChange={(sunlightEffect) => patchLighting({ sunlightEffect })}
            />
            <OptionSelect
              label="室内光"
              value={config.lighting.interiorLight}
              options={INTERIOR_LIGHT_OPTIONS}
              onChange={(interiorLight) => patchLighting({ interiorLight })}
            />
            <OptionSelect
              label="色温"
              value={config.lighting.colorTemperature}
              options={COLOR_TEMPERATURE_OPTIONS}
              onChange={(colorTemperature) =>
                patchLighting({ colorTemperature })
              }
            />
            <OptionSelect
              label="后期色调"
              value={config.lighting.colorGrading}
              options={COLOR_GRADING_OPTIONS}
              onChange={(colorGrading) => patchLighting({ colorGrading })}
            />
            <OptionSelect
              label="影调"
              value={config.lighting.tonalQuality}
              options={TONAL_QUALITY_OPTIONS}
              onChange={(tonalQuality) => patchLighting({ tonalQuality })}
            />
            <div className="col-span-2">
              <OptionSelect
                label="人物与宠物"
                value={config.lighting.occupants}
                options={OCCUPANT_OPTIONS}
                onChange={(occupants) => patchLighting({ occupants })}
              />
            </div>
          </Section>

          <Section
            title="摄影参数"
            summary={`${findInteriorOption(CAMERA_OPTIONS, config.photography.camera).label} / ${findInteriorOption(FOCAL_LENGTH_OPTIONS, config.photography.focalLength).label}`}
          >
            <OptionSelect
              label="相机"
              value={config.photography.camera}
              options={CAMERA_OPTIONS}
              onChange={(camera) => patchPhotography({ camera })}
            />
            <OptionSelect
              label="光圈"
              value={config.photography.aperture}
              options={APERTURE_OPTIONS}
              onChange={(aperture) => patchPhotography({ aperture })}
            />
            <OptionSelect
              label="快门"
              value={config.photography.shutterSpeed}
              options={SHUTTER_OPTIONS}
              onChange={(shutterSpeed) => patchPhotography({ shutterSpeed })}
            />
            <OptionSelect
              label="ISO"
              value={config.photography.iso}
              options={ISO_OPTIONS}
              onChange={(iso) => patchPhotography({ iso })}
            />
            <div className="col-span-2">
              <OptionSelect
                label="焦距"
                value={config.photography.focalLength}
                options={FOCAL_LENGTH_OPTIONS}
                onChange={(focalLength) => patchPhotography({ focalLength })}
              />
            </div>
            <div className="col-span-2 space-y-1 text-[10px] text-[var(--text-muted)]">
              <span>拍摄技法（多选）</span>
              <div className="flex flex-wrap gap-1.5">
                {TECHNIQUE_OPTIONS.map((item) => {
                  const checked = config.photography.techniques.includes(
                    item.id,
                  );
                  return (
                    <label
                      key={item.id}
                      className={`nodrag flex cursor-pointer items-center gap-1 rounded border px-2 py-1 ${checked ? "border-[var(--accent-violet-muted)] bg-[var(--accent-violet-soft)]" : "border-[var(--border-subtle)]"}`}
                    >
                      <input
                        className="sr-only"
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          patchPhotography({
                            techniques: checked
                              ? config.photography.techniques.filter(
                                  (id) => id !== item.id,
                                )
                              : [...config.photography.techniques, item.id],
                          })
                        }
                      />
                      {item.label}
                    </label>
                  );
                })}
              </div>
            </div>
          </Section>

          <Section
            title="核心约束"
            summary={`${findInteriorOption(GEOMETRY_OPTIONS, config.constraints.geometryFidelity).label} / ${findInteriorOption(MATERIAL_OPTIONS, config.constraints.materialConsistency).label}`}
          >
            <OptionSelect
              label="几何保真"
              value={config.constraints.geometryFidelity}
              options={GEOMETRY_OPTIONS}
              onChange={(geometryFidelity) =>
                patchConstraints({ geometryFidelity })
              }
            />
            <OptionSelect
              label="物体一致性"
              value={config.constraints.objectConsistency}
              options={OBJECT_OPTIONS}
              onChange={(objectConsistency) =>
                patchConstraints({ objectConsistency })
              }
            />
            <div className="col-span-2">
              <OptionSelect
                label="材质一致性"
                value={config.constraints.materialConsistency}
                options={MATERIAL_OPTIONS}
                onChange={(materialConsistency) =>
                  patchConstraints({ materialConsistency })
                }
              />
            </div>
            <label className={`${labelClass} col-span-2`}>
              <span>材质精准定义（文本或 JSON 对象）</span>
              <textarea
                className={`${controlClass} min-h-20 resize-y font-mono`}
                value={materialDraft}
                maxLength={12000}
                onChange={(event) => {
                  const value = event.target.value;
                  setMaterialDraft(value);
                  try {
                    const parsed = parseInteriorMaterialDefinition(value);
                    setMaterialError("");
                    patchConstraints({ materialDefinition: parsed });
                  } catch (error) {
                    setMaterialError(
                      error instanceof Error
                        ? error.message
                        : "材质定义格式错误",
                    );
                  }
                }}
              />
              {materialError ? (
                <span className="text-red-400">{materialError}</span>
              ) : null}
            </label>
          </Section>

          <Section
            title="出图参数"
            summary={`${findInteriorOption(ASPECT_RATIO_OPTIONS, config.output.aspectRatio).label} / ${config.output.promptResolution}`}
          >
            <OptionSelect
              label="提示词画幅"
              value={config.output.aspectRatio}
              options={ASPECT_RATIO_OPTIONS}
              onChange={(aspectRatio) =>
                patchOutput({
                  aspectRatio:
                    aspectRatio as InteriorDesignConfigV1["output"]["aspectRatio"],
                })
              }
            />
            <OptionSelect
              label="提示词清晰度"
              value={config.output.promptResolution}
              options={PROMPT_RESOLUTION_OPTIONS}
              onChange={(promptResolution) =>
                patchOutput({
                  promptResolution:
                    promptResolution as InteriorDesignConfigV1["output"]["promptResolution"],
                })
              }
            />
            <label className={`${labelClass} col-span-2`}>
              <span>自定义需求</span>
              <textarea
                className={`${controlClass} min-h-20 resize-y`}
                value={config.customRequirement}
                maxLength={2000}
                onChange={(event) =>
                  patchConfig({ customRequirement: event.target.value })
                }
              />
            </label>
          </Section>

          <details className="group/json border-t border-[var(--border-subtle)]">
            <summary className="nodrag nopan flex h-9 cursor-pointer list-none items-center gap-2 px-0.5 text-[10px] text-[var(--text-muted)] select-none">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/json:rotate-180 group-open/json:text-[var(--accent-violet-strong)]" />
              <span>只读 JSON 预览</span>
              <span className="ml-auto font-mono text-[9px]">JSON</span>
            </summary>
            <pre className="nowheel mb-2.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-[var(--node-control-bg)] p-2.5 text-[9px] leading-4 text-[var(--text-secondary)]">
              {data.compiledPrompt}
            </pre>
          </details>
        </div>

        <div className={themeClasses.nodeFooter}>
          <div className="flex items-center gap-1.5">
            <NodeModelSelector
              category="image"
              config={settingsConfig}
              selection={modelSelection}
              onSelectModel={selectModel}
              stopCanvasGesture={stopCanvasGesture}
              providerAriaLabel="选择图片服务商"
              modelAriaLabel="选择图片模型"
              className="min-w-0 flex-1"
              menuClassName="min-w-[240px]"
              layout="grouped"
            />

            <label className="relative w-20 shrink-0" title="真实接口分辨率">
              <span className="sr-only">真实接口分辨率</span>
              <select
                className={`${controlClass} appearance-none pr-7 font-semibold`}
                value={data.resolution}
                aria-label="真实接口分辨率"
                onChange={(event) =>
                  updateNodeData(id, { resolution: event.target.value })
                }
              >
                {["1K", "2K", "4K"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            </label>

            <button
              type="button"
              className={`${themeClasses.nodePrimaryButton} relative h-9 w-9 shrink-0 shadow-none`}
              disabled={disabledReasons.length > 0 || isBusy}
              onClick={enqueue}
              aria-label={
                data.status === "queued"
                  ? "排队中"
                  : data.status === "generating"
                    ? "生成中"
                    : "生成室内设计图"
              }
            >
              {isBusy ? (
                data.status === "queued" ? (
                  <Clock3 className="h-3.5 w-3.5" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              {activeTaskCount > 0 ? (
                <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-[var(--node-bg)] bg-[var(--accent-violet)] px-1 text-[8px] font-semibold leading-none text-white shadow">
                  {activeTaskCount}
                </span>
              ) : null}
            </button>
          </div>

          {disabledReasons.length > 0 ? (
            <p
              className={`${themeClasses.nodeInlineNotice} ${themeClasses.nodeWarningText}`}
            >
              {disabledReasons.join("；")}
            </p>
          ) : data.errorMsg ? (
            <p
              className={`${themeClasses.nodeInlineNotice} ${themeClasses.nodeErrorText}`}
            >
              {data.errorMsg}
            </p>
          ) : (
            <p className={`${themeClasses.nodeInlineNotice} truncate`}>
              接口画幅 {data.ratio} · 提示词清晰度{" "}
              {config.output.promptResolution}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
