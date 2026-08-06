import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Braces, ChevronDown, FileOutput, Home } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
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
import { useCanvasStore } from "@/store/useCanvasStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import type { AppNodeProps } from "@/types";
import { themeClasses } from "@/styles/themeClasses";
import { NodeDeleteButton, NodeHeader, NodeResizerPreset } from "../nodeShell";
import { getNodeShellClassName } from "../nodeShellClassName";

type Props = AppNodeProps<"interiorDesignNode">;

const controlClass = `nodrag nowheel h-9 w-full px-2.5 text-[11px] ${themeClasses.nodeInput}`;
const labelClass =
  "space-y-1 text-[10px] font-medium leading-none text-[var(--text-muted)]";

function serializeMaterialDefinition(
  value: InteriorDesignConfigV1["constraints"]["materialDefinition"],
) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

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
  const {
    updateInteriorDesignConfig,
    materializeInteriorDesignPrompt,
    deleteNode,
  } = useCanvasStore(
    useShallow((state) => ({
      updateInteriorDesignConfig: state.updateInteriorDesignConfig,
      materializeInteriorDesignPrompt: state.materializeInteriorDesignPrompt,
      deleteNode: state.deleteNode,
    })),
  );
  const runTracked = useHistoryStore((state) => state.runTracked);
  const config = data.config;
  const [materialDraft, setMaterialDraft] = useState(() =>
    serializeMaterialDefinition(config.constraints.materialDefinition),
  );
  const materialDraftRef = useRef(materialDraft);
  const [materialError, setMaterialError] = useState("");

  useEffect(() => {
    try {
      const parsedDraft = parseInteriorMaterialDefinition(
        materialDraftRef.current,
      );
      if (
        JSON.stringify(parsedDraft) ===
        JSON.stringify(config.constraints.materialDefinition)
      ) {
        return;
      }
    } catch {
      // An external history update should replace an invalid local draft.
    }

    const nextDraft = serializeMaterialDefinition(
      config.constraints.materialDefinition,
    );
    materialDraftRef.current = nextDraft;
    setMaterialDraft(nextDraft);
    setMaterialError("");
  }, [config.constraints.materialDefinition]);

  const persistConfig = (next: InteriorDesignConfigV1) => {
    const normalized = normalizeInteriorDesignConfig(next);
    runTracked(() => updateInteriorDesignConfig(id, normalized.config));
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
    const nextMaterialDraft = serializeMaterialDefinition(
      next.constraints.materialDefinition,
    );
    materialDraftRef.current = nextMaterialDraft;
    setMaterialDraft(nextMaterialDraft);
    setMaterialError("");
  };

  const validation = normalizeInteriorDesignConfig(config);
  const outputIssues = [...validation.errors, materialError].filter(Boolean);
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
            <Braces className="h-3 w-3" />
            JSON
          </span>
        }
      />
      <Handle
        type="source"
        position={Position.Right}
        id="prompt"
        className="handle-orb-anchor !h-[18px] !w-[18px] !rounded-full !border-0 !bg-transparent !p-0"
        style={{ top: "50%" }}
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
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                <span className="truncate">{sourceLabel}</span>
                <span className="text-[var(--text-muted)]">→</span>
                <span className="truncate">{targetLabel}</span>
              </div>
              <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                {data.outputTextNodeId ? "提示词已联动" : "尚未输出提示词"}
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
                  materialDraftRef.current = value;
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
        </div>

        <div className={themeClasses.nodeFooter}>
          <button
            type="button"
            className={`${themeClasses.nodePrimaryButton} flex h-9 w-full items-center justify-center gap-2 px-3 text-[11px] font-semibold shadow-none`}
            disabled={outputIssues.length > 0}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              runTracked(() => materializeInteriorDesignPrompt(id));
            }}
            aria-label={
              data.outputTextNodeId ? "重置 JSON 提示词" : "输出 JSON 提示词"
            }
          >
            <FileOutput className="h-3.5 w-3.5" />
            {data.outputTextNodeId ? "重置提示词" : "输出提示词"}
          </button>

          {outputIssues.length > 0 ? (
            <p
              className={`${themeClasses.nodeInlineNotice} ${themeClasses.nodeWarningText}`}
            >
              {outputIssues.join("；")}
            </p>
          ) : (
            <p className={`${themeClasses.nodeInlineNotice} truncate`}>
              {data.outputTextNodeId
                ? `已联动 · ${findInteriorOption(ASPECT_RATIO_OPTIONS, config.output.aspectRatio).label} · ${config.output.promptResolution}`
                : `${findInteriorOption(ASPECT_RATIO_OPTIONS, config.output.aspectRatio).label} · ${config.output.promptResolution}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
