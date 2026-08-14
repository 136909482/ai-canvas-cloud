import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Handle, Position } from "@xyflow/react";
import {
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  Copy,
  FileOutput,
  Home,
  Info,
  Search,
  Settings2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import {
  applyInteriorLightingPatch,
  applyInteriorPhotographyPatch,
  applyInteriorScenePatch,
  normalizeInteriorDesignConfig,
  parseInteriorMaterialDefinition,
} from "@/features/interiorDesign/compiler";
import {
  APERTURE_OPTIONS,
  ASPECT_RATIO_OPTIONS,
  CAMERA_OPTIONS,
  COLOR_GRADING_OPTIONS,
  COLOR_TEMPERATURE_OPTIONS,
  CONVERSION_LOGIC_OPTIONS,
  CONVERSION_GOAL_OPTIONS,
  CURTAIN_OPTIONS,
  DESIGN_STYLE_OPTIONS,
  EXTERIOR_VIEW_OPTIONS,
  FOCAL_LENGTH_OPTIONS,
  GEOMETRY_OPTIONS,
  INTERIOR_LIGHT_OPTIONS,
  INTERIOR_PRESETS,
  ISO_OPTIONS,
  LIGHT_ENTRY_MODE_OPTIONS,
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
import { InlineSelect } from "../InlineSelect";
import { NodeDeleteButton, NodeHeader, NodeResizerPreset } from "../nodeShell";
import { getNodeShellClassName } from "../nodeShellClassName";

type Props = AppNodeProps<"interiorDesignNode">;
const controlClass = `nodrag nowheel h-9 w-full px-2.5 text-[11px] ${themeClasses.nodeInput}`;
const labelClass =
  "space-y-1.5 text-[10px] font-medium leading-4 text-[var(--text-muted)] [&>div>button]:h-10 [&>div>button]:px-3.5";
const CustomSelectionContext = createContext<{
  values: Record<string, string>;
  update: (key: string, value: string) => void;
} | null>(null);
const CUSTOM_LABEL_ALIASES: Record<string, string> = {
  时间: "lighting.timeOfDay",
  室内灯光: "lighting.interiorLight",
  相机: "photography.camera",
  焦距: "photography.focalLength",
  光圈: "photography.aperture",
  快门: "photography.shutterSpeed",
  ISO: "photography.iso",
};
const MATERIAL_IDENTIFICATION_GUIDANCE =
  "请分析这张模型截图，识别图中所有独立的材质元素。严格按“天花及顶面、墙面及立面、地面、固定硬装（柜体/门窗/楼梯等）、可移动软装（家具/灯具/摆件等）”作为 JSON 顶层分类，每个分类的值必须是数组；数组中每项必须且只能包含“元素名称”“材质类型”“质感描述”“表面特征”“反光特性”五个字符串字段。元素名称必须对应图中物体，描述要具体、可执行并符合室内设计行业术语，不要遗漏任何可见材质区域。只输出一个严格合法的 JSON 对象：所有属性名和字符串必须使用英文双引号，最后一项后禁止添加逗号，禁止注释，禁止 Markdown 代码块，禁止输出解释或其他文字。输出前请自行检查 JSON 能否被 JSON.parse 直接解析。";
const steps = [
  { id: "basics", label: "基础", hint: "先选来源和目标" },
  { id: "scene", label: "场景", hint: "描述空间和风格" },
  { id: "lighting", label: "氛围", hint: "调整光线感觉" },
  { id: "output", label: "输出", hint: "确认画面和细节" },
  { id: "photography", label: "摄影", hint: "控制相机语言" },
  { id: "constraints", label: "约束", hint: "保护原图结构" },
] as const;

const EDITOR_SEARCH_ITEMS = [
  { section: "basics", label: "来源软件 转换目标 转换逻辑 PBR 写实" },
  { section: "scene", label: "空间类型 设计风格 外景 地点 夜景" },
  {
    section: "lighting",
    label:
      "预设 季节 天气 时间 窗帘 进光方向 太阳光影 室内灯光 色温 色调 影调 人物 宠物",
  },
  { section: "output", label: "画面比例 分辨率 自定义需求 JSON" },
  {
    section: "photography",
    label: "相机 焦距 光圈 快门 ISO HDR 曝光 移轴 三脚架",
  },
  { section: "constraints", label: "几何保真 物体一致 材质一致 材质精准定义" },
] as const;

const PROFESSIONAL_HELP = [
  ["光圈", "数值越小进光越多、景深越浅；室内全景通常使用 f/5.6 至 f/11。"],
  ["快门", "决定曝光时间和运动拖影；1 秒及更慢适合三脚架长曝光。"],
  ["ISO", "数值越低画质越干净；光线不足时提高 ISO 会增加噪点。"],
  ["焦距", "13-24mm 画面更宽，48mm 以上适合软装与材质细节。"],
  ["曝光技法", "HDR 适合大光比，移轴用于保持竖线垂直，长曝需要慢快门。"],
  ["色温与光影", "人工光关闭时无需调整色温；直射、树影和丁达尔通常需要晴天。"],
] as const;

const CUSTOM_FIELD_DEFS = [
  ["conversionGoal", "转换目标"],
  ["conversionLogic", "转换逻辑"],
  ["scene.spaceType", "空间类型"],
  ["scene.designStyle", "设计风格"],
  ["scene.exteriorView", "外景类型"],
  ["scene.location", "地点"],
  ["lighting.season", "季节"],
  ["lighting.weather", "天气"],
  ["lighting.timeOfDay", "时间段"],
  ["lighting.curtainType", "窗帘类型"],
  ["lighting.sunlightEffect", "太阳光影"],
  ["lighting.interiorLight", "室内光"],
  ["lighting.colorTemperature", "室内灯光色温"],
  ["lighting.colorGrading", "后期色调"],
  ["lighting.tonalQuality", "光影品质"],
  ["lighting.occupants", "人物、宠物配置"],
  ["photography.camera", "相机型号"],
  ["photography.aperture", "光圈"],
  ["photography.shutterSpeed", "快门速度"],
  ["photography.iso", "ISO"],
  ["photography.focalLength", "全画幅等效焦距"],
  ["constraints.geometryFidelity", "几何保真度"],
  ["constraints.objectConsistency", "物体完整一致性"],
  ["constraints.materialConsistency", "材质完整一致性"],
  ["output.aspectRatio", "出图比例"],
  ["output.promptResolution", "分辨率"],
] as const;

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
  wrapperClassName = "col-span-2",
}: {
  label: string;
  value: string;
  options: InteriorOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  wrapperClassName?: string;
}) {
  const custom = useContext(CustomSelectionContext);
  const selectedOption = options.find((item) => item.id === value);
  return (
    <>
      <label className={`${labelClass} ${wrapperClassName}`}>
        <span>{label}</span>
        <InlineSelect
          value={value}
          options={options.map((item) => ({
            value: item.id,
            label: item.label,
            title: item.prompt,
          }))}
          ariaLabel={label}
          disabled={disabled}
          onChange={onChange}
          stopCanvasGesture={(event) => event.stopPropagation()}
        />
        <span className="block min-h-4 text-[9px] leading-4 text-[var(--text-muted)]">
          {disabled ? "当前设置下暂不可调整" : selectedOption?.prompt}
        </span>
      </label>
      {value === "custom" && custom ? (
        <label className={`${labelClass} col-span-2`}>
          <span>{label}自定义值</span>
          <input
            className={controlClass}
            value={custom.values[label] ?? ""}
            maxLength={500}
            placeholder={`请输入${label}`}
            onChange={(event) => custom.update(label, event.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}

function WizardStep({
  title,
  description,
  defaultOpen = false,
  collapsible = true,
  orderClass = "order-none",
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  orderClass?: string;
  children: React.ReactNode;
}) {
  if (!collapsible) {
    return (
      <div className={`grid grid-cols-2 gap-x-3 gap-y-2 ${orderClass}`}>
        {children}
      </div>
    );
  }
  return (
    <details
      className={`group/category ${orderClass} border-b border-[var(--border-subtle)] pb-2`}
      open={defaultOpen}
    >
      <summary className="nodrag nopan flex cursor-pointer list-none items-center gap-3 px-1 py-2 select-none">
        <span className="text-[11px] font-semibold text-[var(--text-primary)] group-open/category:text-[var(--accent-violet-strong)]">
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-[var(--text-muted)]">
          {description}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-open/category:rotate-180 group-open/category:text-[var(--accent-violet-strong)]" />
      </summary>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-1 pt-2 pb-1">
        {children}
      </div>
    </details>
  );
}

function Summary({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)] px-2.5 py-2 text-[10px] text-[var(--text-secondary)]">
      {children}
    </div>
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
  const [step, setStep] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSection, setEditorSection] =
    useState<(typeof steps)[number]["id"]>("basics");
  const [editorView, setEditorView] = useState<"section" | "all">("section");
  const [editorSearch, setEditorSearch] = useState("");
  const [jsonCopied, setJsonCopied] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<"photography" | "constraints">(
    "photography",
  );
  const [materialDraft, setMaterialDraft] = useState(() =>
    serializeMaterialDefinition(config.constraints.materialDefinition),
  );
  const materialDraftRef = useRef(materialDraft);
  const [materialError, setMaterialError] = useState("");
  const [materialGuidanceCopied, setMaterialGuidanceCopied] = useState(false);
  const copyCompiledPrompt = async () => {
    try {
      await navigator.clipboard.writeText(data.compiledPrompt);
      setJsonCopied(true);
      window.setTimeout(() => setJsonCopied(false), 1800);
    } catch {
      setJsonCopied(false);
    }
  };

  useEffect(() => {
    try {
      if (
        JSON.stringify(
          parseInteriorMaterialDefinition(materialDraftRef.current),
        ) === JSON.stringify(config.constraints.materialDefinition)
      )
        return;
    } catch {
      /* replace invalid local draft after an external update */
    }
    const next = serializeMaterialDefinition(
      config.constraints.materialDefinition,
    );
    materialDraftRef.current = next;
    setMaterialDraft(next);
    setMaterialError("");
  }, [config.constraints.materialDefinition]);

  const persistConfig = (next: InteriorDesignConfigV1) =>
    runTracked(() =>
      updateInteriorDesignConfig(
        id,
        normalizeInteriorDesignConfig(next).config,
      ),
    );
  const patchConfig = (patch: Partial<InteriorDesignConfigV1>) =>
    persistConfig({ ...config, ...patch });
  const patchScene = (patch: Partial<InteriorDesignConfigV1["scene"]>) =>
    persistConfig(applyInteriorScenePatch(config, patch));
  const patchLighting = (patch: Partial<InteriorDesignConfigV1["lighting"]>) =>
    persistConfig(applyInteriorLightingPatch(config, patch));
  const patchPhotography = (
    patch: Partial<InteriorDesignConfigV1["photography"]>,
  ) => persistConfig(applyInteriorPhotographyPatch(config, patch));
  const patchConstraints = (
    patch: Partial<InteriorDesignConfigV1["constraints"]>,
  ) => patchConfig({ constraints: { ...config.constraints, ...patch } });
  const patchOutput = (patch: Partial<InteriorDesignConfigV1["output"]>) =>
    patchConfig({ output: { ...config.output, ...patch } });
  const patchCustomSelection = (path: string, value: string) =>
    patchConfig({
      customSelections: { ...(config.customSelections ?? {}), [path]: value },
    });
  const copyMaterialGuidance = async () => {
    try {
      await navigator.clipboard.writeText(MATERIAL_IDENTIFICATION_GUIDANCE);
      setMaterialGuidanceCopied(true);
      window.setTimeout(() => setMaterialGuidanceCopied(false), 1800);
    } catch {
      setMaterialGuidanceCopied(false);
    }
  };
  const customRuntimeValues = Object.fromEntries(
    CUSTOM_FIELD_DEFS.flatMap(([path, label]) => [
      [
        label,
        config.customSelections?.[path] ??
          config.customSelections?.[label] ??
          "",
      ],
      [path, config.customSelections?.[path] ?? ""],
      ...Object.entries(CUSTOM_LABEL_ALIASES)
        .filter(([, aliasPath]) => aliasPath === path)
        .map(([alias]) => [
          alias,
          config.customSelections?.[path] ??
            config.customSelections?.[alias] ??
            "",
        ]),
    ]),
  );
  const updateCustomByLabel = (label: string, value: string) => {
    const definition = CUSTOM_FIELD_DEFS.find(([, item]) => item === label);
    patchCustomSelection(
      definition?.[0] ?? CUSTOM_LABEL_ALIASES[label] ?? label,
      value,
    );
  };
  const choosePreset = (presetId: string) => {
    const preset = INTERIOR_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const next = applyInteriorPreset(config, preset.id);
    persistConfig(next);
    const draft = serializeMaterialDefinition(
      next.constraints.materialDefinition,
    );
    materialDraftRef.current = draft;
    setMaterialDraft(draft);
    setMaterialError("");
  };

  const validation = normalizeInteriorDesignConfig(config);
  const blockingIssues = [...validation.errors, materialError].filter(Boolean);
  const outputIssues = [...blockingIssues, ...validation.warnings];
  const searchResults = editorSearch.trim()
    ? EDITOR_SEARCH_ITEMS.filter((item) =>
        item.label.toLowerCase().includes(editorSearch.trim().toLowerCase()),
      )
    : [];
  const showEditorSection = (section: (typeof steps)[number]["id"]) =>
    editorView === "all" || editorSection === section;
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
  const sceneSummary = `${findInteriorOption(SPACE_TYPE_OPTIONS, config.scene.spaceType).label} · ${findInteriorOption(DESIGN_STYLE_OPTIONS, config.scene.designStyle).label}`;
  const presetLabel =
    INTERIOR_PRESETS.find((item) => item.id === config.presetId)?.label ??
    "自定义";

  return (
    <CustomSelectionContext.Provider
      value={{ values: customRuntimeValues, update: updateCustomByLabel }}
    >
      <div className={getNodeShellClassName({ selected })}>
        <NodeResizerPreset
          selected={selected}
          minWidth={520}
          minHeight={520}
          maxHeight={720}
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
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={`${themeClasses.iconButton} h-7 w-7`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={copyCompiledPrompt}
                aria-label={jsonCopied ? "JSON 已复制" : "复制室内设计 JSON"}
                title={jsonCopied ? "JSON 已复制" : "复制室内设计 JSON"}
              >
                {jsonCopied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                className={`${themeClasses.iconButton} h-7 w-7`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setEditorOpen(true)}
                aria-label="编辑室内设计设置"
                title="编辑室内设计设置"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <span
                className={`${themeClasses.nodeBadge} ${themeClasses.nodeBadgeViolet}`}
              >
                <Braces className="h-3 w-3" />
                JSON
              </span>
            </div>
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

        {!editorOpen ? (
          <div className="nowheel flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain p-3 scrollbar-hidden">
            <div className="flex min-h-0 flex-1 gap-3">
              <nav
                className="w-24 shrink-0 space-y-1 overflow-y-auto pr-1 scrollbar-hidden"
                aria-label="室内设计类别"
              >
                {steps.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setEditorSection(item.id)}
                    aria-current={
                      editorSection === item.id ? "page" : undefined
                    }
                    className={`w-full rounded-md px-2 py-2 text-left text-[10px] transition ${editorSection === item.id ? "bg-[var(--accent-violet-soft)] font-semibold text-[var(--accent-violet-strong)]" : "text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)]"}`}
                  >
                    <span className="block truncate">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[9px] opacity-70">
                      {item.hint}
                    </span>
                  </button>
                ))}
              </nav>

              <div className="nowheel min-w-0 flex-1 overflow-y-auto pr-1 scrollbar-hidden">
                {showEditorSection("basics") ? (
                  <WizardStep
                    title="任务指令"
                    description="选择一个预设即可快速开始，之后仍可继续微调。"
                    collapsible={false}
                    defaultOpen
                    orderClass="order-1"
                  >
                    <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
                      <OptionSelect
                        label="来源类型"
                        value={config.sourceSoftware}
                        options={SOURCE_SOFTWARE_OPTIONS}
                        wrapperClassName="col-span-1"
                        onChange={(sourceSoftware) =>
                          patchConfig({
                            sourceSoftware:
                              sourceSoftware as InteriorDesignConfigV1["sourceSoftware"],
                          })
                        }
                      />
                      <ArrowRight
                        className="mt-8 h-4 w-4 text-[var(--accent-violet-strong)]"
                        aria-hidden="true"
                      />
                      <OptionSelect
                        label="转换目标"
                        value={config.conversionGoal}
                        options={CONVERSION_GOAL_OPTIONS}
                        wrapperClassName="col-span-1"
                        onChange={(conversionGoal) =>
                          patchConfig({
                            conversionGoal:
                              conversionGoal as InteriorDesignConfigV1["conversionGoal"],
                          })
                        }
                      />
                    </div>
                    {config.sourceSoftware === "custom" ? (
                      <label className={`${labelClass} col-span-2`}>
                        <span>来源名称</span>
                        <input
                          className={controlClass}
                          value={config.customSourceSoftware}
                          maxLength={80}
                          onChange={(event) =>
                            patchConfig({
                              customSourceSoftware: event.target.value,
                            })
                          }
                        />
                      </label>
                    ) : null}
                    <OptionSelect
                      label="转换逻辑"
                      value={config.conversionLogic ?? "pbr-photoreal"}
                      options={CONVERSION_LOGIC_OPTIONS}
                      onChange={(conversionLogic) =>
                        patchConfig({
                          conversionLogic:
                            conversionLogic as InteriorDesignConfigV1["conversionLogic"],
                        })
                      }
                    />
                  </WizardStep>
                ) : null}

                {showEditorSection("scene") ? (
                  <WizardStep
                    title="场景类型"
                    description="告诉 AI 这是怎样的房间，以及你想要的风格。"
                    collapsible={false}
                    orderClass="order-2"
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
                      onChange={(exteriorView) => patchScene({ exteriorView })}
                    />
                    <OptionSelect
                      label="地点"
                      value={config.scene.location}
                      options={LOCATION_OPTIONS}
                      disabled={isEnclosed}
                      onChange={(location) => patchScene({ location })}
                    />
                    {isEnclosed ? (
                      <p className="col-span-2 text-[10px] text-[var(--text-muted)]">
                        封闭空间不需要设置窗外地点和自然光。
                      </p>
                    ) : null}
                  </WizardStep>
                ) : null}

                {showEditorSection("lighting") ? (
                  <WizardStep
                    title="光影氛围"
                    description="用少量选择控制光线的时间、方向和室内感觉。"
                    collapsible={false}
                    orderClass="order-3"
                  >
                    <OptionSelect
                      label="光照预设"
                      value={config.presetId}
                      options={INTERIOR_PRESETS.map((p) => ({
                        id: p.id,
                        label: p.label,
                        prompt: p.description,
                      }))}
                      onChange={choosePreset}
                    />
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
                    <OptionSelect
                      label="进光方向"
                      value={config.lighting.lightEntryMode}
                      options={LIGHT_ENTRY_MODE_OPTIONS}
                      onChange={(lightEntryMode) =>
                        patchLighting({
                          lightEntryMode:
                            lightEntryMode as InteriorDesignConfigV1["lighting"]["lightEntryMode"],
                        })
                      }
                    />
                    <OptionSelect
                      label="阳光效果"
                      value={config.lighting.sunlightEffect}
                      options={SUNLIGHT_OPTIONS}
                      disabled={config.lighting.lightEntryMode === "disabled"}
                      onChange={(sunlightEffect) =>
                        patchLighting({ sunlightEffect })
                      }
                    />
                    <OptionSelect
                      label="室内灯光"
                      value={config.lighting.interiorLight}
                      options={INTERIOR_LIGHT_OPTIONS}
                      onChange={(interiorLight) =>
                        patchLighting({ interiorLight })
                      }
                    />
                    <OptionSelect
                      label="色温"
                      value={config.lighting.colorTemperature}
                      options={COLOR_TEMPERATURE_OPTIONS}
                      disabled={
                        config.lighting.interiorLight === "natural-only"
                      }
                      onChange={(colorTemperature) =>
                        patchLighting({ colorTemperature })
                      }
                    />
                    <OptionSelect
                      label="后期色调"
                      value={config.lighting.colorGrading}
                      options={COLOR_GRADING_OPTIONS}
                      onChange={(colorGrading) =>
                        patchLighting({ colorGrading })
                      }
                    />
                    <OptionSelect
                      label="光影品质"
                      value={config.lighting.tonalQuality}
                      options={TONAL_QUALITY_OPTIONS}
                      onChange={(tonalQuality) =>
                        patchLighting({ tonalQuality })
                      }
                    />
                    <OptionSelect
                      label="人物、宠物配置"
                      value={config.lighting.occupants}
                      options={OCCUPANT_OPTIONS}
                      onChange={(occupants) => patchLighting({ occupants })}
                    />
                  </WizardStep>
                ) : null}

                {showEditorSection("output") ? (
                  <WizardStep
                    title="出图参数"
                    description="先选画面比例；专业参数可以在高级设置中继续调整。"
                    collapsible={false}
                    orderClass="order-6"
                  >
                    <OptionSelect
                      label="画面比例"
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
                      <span>自定义需求（可选）</span>
                      <textarea
                        className={`${controlClass} min-h-16 resize-none py-2.5`}
                        value={config.customRequirement}
                        maxLength={2000}
                        onChange={(event) =>
                          patchConfig({ customRequirement: event.target.value })
                        }
                      />
                    </label>
                    <div className="hidden">
                      <div
                        className="nodrag nopan grid grid-cols-2 gap-1 rounded-md bg-[var(--control-bg)] p-1"
                        role="tablist"
                        aria-label="高级设置分页"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={advancedTab === "photography"}
                          onClick={() => setAdvancedTab("photography")}
                          className={`rounded px-2 py-1.5 text-[10px] font-medium ${advancedTab === "photography" ? "bg-[var(--accent-violet-soft)] text-[var(--accent-violet-strong)]" : "text-[var(--text-muted)]"}`}
                        >
                          摄影参数
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={advancedTab === "constraints"}
                          onClick={() => setAdvancedTab("constraints")}
                          className={`rounded px-2 py-1.5 text-[10px] font-medium ${advancedTab === "constraints" ? "bg-[var(--accent-violet-soft)] text-[var(--accent-violet-strong)]" : "text-[var(--text-muted)]"}`}
                        >
                          核心约束
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {advancedTab === "photography" ? (
                          <>
                            <OptionSelect
                              label="相机"
                              value={config.photography.camera}
                              options={CAMERA_OPTIONS}
                              onChange={(camera) =>
                                patchPhotography({ camera })
                              }
                            />
                            <OptionSelect
                              label="焦距"
                              value={config.photography.focalLength}
                              options={FOCAL_LENGTH_OPTIONS}
                              onChange={(focalLength) =>
                                patchPhotography({ focalLength })
                              }
                            />
                            <OptionSelect
                              label="光圈"
                              value={config.photography.aperture}
                              options={APERTURE_OPTIONS}
                              onChange={(aperture) =>
                                patchPhotography({ aperture })
                              }
                            />
                            <OptionSelect
                              label="快门"
                              value={config.photography.shutterSpeed}
                              options={SHUTTER_OPTIONS}
                              onChange={(shutterSpeed) =>
                                patchPhotography({ shutterSpeed })
                              }
                            />
                            <OptionSelect
                              label="ISO"
                              value={config.photography.iso}
                              options={ISO_OPTIONS}
                              onChange={(iso) => patchPhotography({ iso })}
                            />
                            <OptionSelect
                              label="后期色调"
                              value={config.lighting.colorGrading}
                              options={COLOR_GRADING_OPTIONS}
                              onChange={(colorGrading) =>
                                patchLighting({ colorGrading })
                              }
                            />
                            <OptionSelect
                              label="影调"
                              value={config.lighting.tonalQuality}
                              options={TONAL_QUALITY_OPTIONS}
                              onChange={(tonalQuality) =>
                                patchLighting({ tonalQuality })
                              }
                            />
                            <OptionSelect
                              label="人物与宠物"
                              value={config.lighting.occupants}
                              options={OCCUPANT_OPTIONS}
                              onChange={(occupants) =>
                                patchLighting({ occupants })
                              }
                            />
                            <div className="col-span-2 space-y-1 text-[10px] text-[var(--text-muted)]">
                              <span>摄影技法（可多选）</span>
                              <div className="flex flex-wrap gap-1.5">
                                {TECHNIQUE_OPTIONS.map((item) => {
                                  const checked =
                                    config.photography.techniques.includes(
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
                                              : [
                                                  ...config.photography
                                                    .techniques,
                                                  item.id,
                                                ],
                                          })
                                        }
                                      />
                                      {item.label}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </>
                        ) : null}
                        {advancedTab === "constraints" ? (
                          <>
                            <OptionSelect
                              label="物体一致性"
                              value={config.constraints.objectConsistency}
                              options={OBJECT_OPTIONS}
                              onChange={(objectConsistency) =>
                                patchConstraints({ objectConsistency })
                              }
                            />
                            <OptionSelect
                              label="材质一致性"
                              value={config.constraints.materialConsistency}
                              options={MATERIAL_OPTIONS}
                              onChange={(materialConsistency) =>
                                patchConstraints({ materialConsistency })
                              }
                            />
                            <OptionSelect
                              label="几何保真"
                              value={config.constraints.geometryFidelity}
                              options={GEOMETRY_OPTIONS}
                              onChange={(geometryFidelity) =>
                                patchConstraints({ geometryFidelity })
                              }
                            />
                            <label className={`${labelClass} col-span-2`}>
                              <span>材质定义（文本或 JSON）</span>
                              <button
                                type="button"
                                className="nodrag inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent-violet-muted)] hover:text-[var(--text-primary)]"
                                title={MATERIAL_IDENTIFICATION_GUIDANCE}
                                onClick={copyMaterialGuidance}
                              >
                                {materialGuidanceCopied ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                {materialGuidanceCopied
                                  ? "已复制材质识别提示词"
                                  : "复制材质识别提示词"}
                              </button>
                              <textarea
                                className={`${controlClass} min-h-16 resize-none py-2.5 font-mono`}
                                value={materialDraft}
                                maxLength={12000}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  materialDraftRef.current = value;
                                  setMaterialDraft(value);
                                  try {
                                    setMaterialError("");
                                    patchConstraints({
                                      materialDefinition:
                                        parseInteriorMaterialDefinition(value),
                                    });
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
                                <span className="text-red-400">
                                  {materialError}
                                </span>
                              ) : null}
                            </label>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </WizardStep>
                ) : null}

                {showEditorSection("photography") ? (
                  <WizardStep
                    title="摄影参数"
                    description="参考项目将相机、曝光、焦距和拍摄技法作为独立大类；普通用户保持默认即可。"
                    collapsible={false}
                    orderClass="order-4"
                  >
                    <OptionSelect
                      label="相机型号"
                      value={config.photography.camera}
                      options={CAMERA_OPTIONS}
                      onChange={(camera) => patchPhotography({ camera })}
                    />
                    <OptionSelect
                      label="焦距"
                      value={config.photography.focalLength}
                      options={FOCAL_LENGTH_OPTIONS}
                      onChange={(focalLength) =>
                        patchPhotography({ focalLength })
                      }
                    />
                    <OptionSelect
                      label="光圈"
                      value={config.photography.aperture}
                      options={APERTURE_OPTIONS}
                      onChange={(aperture) => patchPhotography({ aperture })}
                    />
                    <OptionSelect
                      label="快门速度"
                      value={config.photography.shutterSpeed}
                      options={SHUTTER_OPTIONS}
                      onChange={(shutterSpeed) =>
                        patchPhotography({ shutterSpeed })
                      }
                    />
                    <OptionSelect
                      label="ISO 感光度"
                      value={config.photography.iso}
                      options={ISO_OPTIONS}
                      onChange={(iso) => patchPhotography({ iso })}
                    />
                    <div className="col-span-2 space-y-1 text-[10px] text-[var(--text-muted)]">
                      <span>拍摄技法（可多选）</span>
                      <div className="flex flex-wrap gap-1.5">
                        {TECHNIQUE_OPTIONS.map((item) => {
                          const checked =
                            config.photography.techniques.includes(item.id);
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
                                      : [
                                          ...config.photography.techniques,
                                          item.id,
                                        ],
                                  })
                                }
                              />
                              {item.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </WizardStep>
                ) : null}

                {showEditorSection("constraints") ? (
                  <WizardStep
                    title="核心约束"
                    description="参考项目把结构、物体和材质保护单独列出，确保改图时不乱改原设计。"
                    collapsible={false}
                    orderClass="order-5"
                  >
                    <OptionSelect
                      label="几何保真度"
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
                      <span>材质精准定义（文本或 JSON）</span>
                      <button
                        type="button"
                        className="nodrag inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent-violet-muted)] hover:text-[var(--text-primary)]"
                        title={MATERIAL_IDENTIFICATION_GUIDANCE}
                        onClick={copyMaterialGuidance}
                      >
                        {materialGuidanceCopied ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {materialGuidanceCopied
                          ? "已复制材质识别提示词"
                          : "复制材质识别提示词"}
                      </button>
                      <textarea
                        className={`${controlClass} min-h-24 resize-none py-2.5 font-mono`}
                        value={materialDraft}
                        maxLength={12000}
                        onChange={(event) => {
                          const value = event.target.value;
                          materialDraftRef.current = value;
                          setMaterialDraft(value);
                          try {
                            setMaterialError("");
                            patchConstraints({
                              materialDefinition:
                                parseInteriorMaterialDefinition(value),
                            });
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
                  </WizardStep>
                ) : null}
              </div>
            </div>

            <div
              className={`${themeClasses.nodeFooter} hidden flex items-center gap-2`}
            >
              {step > 0 ? (
                <button
                  type="button"
                  className={`${themeClasses.nodeActionButton} h-9 px-3 text-[11px]`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setStep((current) => current - 1)}
                >
                  上一步
                </button>
              ) : null}
              {step < steps.length - 1 ? (
                <button
                  type="button"
                  className={`${themeClasses.nodePrimaryButton} h-9 flex-1 px-3 text-[11px] font-semibold`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setStep((current) => current + 1)}
                >
                  下一步
                </button>
              ) : (
                <button
                  type="button"
                  className={`${themeClasses.nodePrimaryButton} h-9 flex-1 items-center gap-2 px-3 text-[11px] font-semibold`}
                  disabled={blockingIssues.length > 0}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    runTracked(() => materializeInteriorDesignPrompt(id));
                  }}
                >
                  <FileOutput className="h-3.5 w-3.5" />
                  {data.outputTextNodeId ? "重新输出提示词" : "输出提示词"}
                </button>
              )}
              {outputIssues.length > 0 ? (
                <p
                  className={`${themeClasses.nodeInlineNotice} ${themeClasses.nodeWarningText} max-w-[45%] truncate`}
                  title={outputIssues.join("；")}
                >
                  {outputIssues.join("；")}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {!editorOpen ? (
          <div className="hidden flex-1 flex-col gap-3 p-3">
            <Summary>
              <span className="font-medium text-[var(--text-primary)]">
                {sourceLabel} → {targetLabel}
              </span>
              <span className="mx-1.5 text-[var(--text-muted)]">·</span>
              {sceneSummary}
            </Summary>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)] p-2">
                <span className="block text-[var(--text-muted)]">光影预设</span>
                <span className="mt-1 block truncate text-[var(--text-primary)]">
                  {presetLabel}
                </span>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--control-bg)] p-2">
                <span className="block text-[var(--text-muted)]">输出</span>
                <span className="mt-1 block truncate text-[var(--text-primary)]">
                  {
                    findInteriorOption(
                      ASPECT_RATIO_OPTIONS,
                      config.output.aspectRatio,
                    ).label
                  }{" "}
                  · {config.output.promptResolution}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={`${themeClasses.nodeActionButton} h-9 w-full text-[11px] font-semibold`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setEditorOpen(true)}
            >
              编辑室内设计
            </button>
            <button
              type="button"
              className={`${themeClasses.nodePrimaryButton} h-9 w-full gap-2 text-[11px] font-semibold`}
              disabled={blockingIssues.length > 0}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                runTracked(() => materializeInteriorDesignPrompt(id));
              }}
            >
              <FileOutput className="h-3.5 w-3.5" />
              {data.outputTextNodeId ? "重新输出提示词" : "输出提示词"}
            </button>
          </div>
        ) : null}

        <div
          className={`${themeClasses.nodeFooter} flex flex-col items-stretch gap-2 px-1 pb-1`}
        >
          <span className="min-h-4 truncate text-[10px] leading-4 text-[var(--text-muted)]">
            {data.outputTextNodeId ? "提示词已连接" : "准备好后输出提示词"}
          </span>
          <div>
            <button
              type="button"
              className={`${themeClasses.nodePrimaryButton} h-10 w-full gap-2 px-3 text-[11px] font-semibold shadow-[0_6px_16px_rgba(124,58,237,0.24)]`}
              disabled={validation.errors.length > 0 || Boolean(materialError)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                runTracked(() => materializeInteriorDesignPrompt(id));
              }}
            >
              <FileOutput className="h-3.5 w-3.5" />
              输出提示词
            </button>
          </div>
        </div>

        {editorOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
                onPointerDown={() => setEditorOpen(false)}
              >
                <aside
                  role="dialog"
                  aria-modal="true"
                  aria-label="室内设计设置"
                  className="nodrag nopan flex h-[min(780px,calc(100vh-2rem))] max-h-full w-[min(860px,calc(100vw-2rem))] flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] p-5 text-[var(--text-primary)] shadow-2xl"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-4">
                    <div>
                      <p className="text-xs font-semibold">室内设计设置</p>
                      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                        按类别调整，修改会即时保存
                      </p>
                    </div>
                    <button
                      type="button"
                      className={themeClasses.iconButton}
                      onClick={() => setEditorOpen(false)}
                      aria-label="关闭编辑面板"
                    >
                      ×
                    </button>
                  </div>
                  <div className="space-y-2 border-b border-[var(--border-subtle)] py-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
                      <input
                        className={`${controlClass} pl-8`}
                        value={editorSearch}
                        placeholder="搜索参数、光影或摄影设置"
                        aria-label="搜索室内设计参数"
                        onChange={(event) =>
                          setEditorSearch(event.target.value)
                        }
                      />
                    </div>
                    {searchResults.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {searchResults.map((result) => {
                          const stepItem = steps.find(
                            (item) => item.id === result.section,
                          );
                          return (
                            <button
                              key={result.section}
                              type="button"
                              className="rounded border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent-violet-muted)]"
                              onClick={() => {
                                setEditorView("section");
                                setEditorSection(result.section);
                                setEditorSearch("");
                              }}
                            >
                              {stepItem?.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-1 rounded-md bg-[var(--control-bg)] p-1">
                      {(["section", "all"] as const).map((view) => (
                        <button
                          key={view}
                          type="button"
                          className={`rounded px-2 py-1.5 text-[10px] ${editorView === view ? "bg-[var(--panel-bg-strong)] font-semibold text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)]"}`}
                          onClick={() => setEditorView(view)}
                        >
                          {view === "section" ? "按分区编辑" : "全部参数"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 gap-4 py-4">
                    <nav
                      className={`w-24 shrink-0 space-y-1 ${editorView === "all" ? "hidden" : ""}`}
                    >
                      {steps.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setEditorSection(item.id)}
                          className={`w-full rounded-lg px-2 py-2 text-left text-[11px] ${editorSection === item.id ? "bg-[var(--accent-violet-soft)] font-semibold text-[var(--accent-violet-strong)]" : "text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)]"}`}
                        >
                          {item.label}
                          <span className="mt-0.5 block text-[9px] opacity-70">
                            {item.hint}
                          </span>
                        </button>
                      ))}
                    </nav>
                    <div className="min-w-0 flex-1 overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 gap-3">
                        {showEditorSection("basics") ? (
                          <>
                            <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
                              <OptionSelect
                                label="来源类型"
                                value={config.sourceSoftware}
                                options={SOURCE_SOFTWARE_OPTIONS}
                                wrapperClassName="col-span-1"
                                onChange={(value) =>
                                  patchConfig({
                                    sourceSoftware:
                                      value as InteriorDesignConfigV1["sourceSoftware"],
                                  })
                                }
                              />
                              <ArrowRight
                                className="mt-8 h-4 w-4 text-[var(--accent-violet-strong)]"
                                aria-hidden="true"
                              />
                              <OptionSelect
                                label="转换目标"
                                value={config.conversionGoal}
                                options={CONVERSION_GOAL_OPTIONS}
                                wrapperClassName="col-span-1"
                                onChange={(value) =>
                                  patchConfig({
                                    conversionGoal:
                                      value as InteriorDesignConfigV1["conversionGoal"],
                                  })
                                }
                              />
                            </div>
                            {config.sourceSoftware === "custom" ? (
                              <label className={`${labelClass} col-span-2`}>
                                <span>来源名称</span>
                                <input
                                  className={controlClass}
                                  value={config.customSourceSoftware}
                                  maxLength={80}
                                  onChange={(event) =>
                                    patchConfig({
                                      customSourceSoftware: event.target.value,
                                    })
                                  }
                                />
                              </label>
                            ) : null}
                            <OptionSelect
                              label="转换逻辑"
                              value={config.conversionLogic ?? "pbr-photoreal"}
                              options={CONVERSION_LOGIC_OPTIONS}
                              onChange={(value) =>
                                patchConfig({
                                  conversionLogic:
                                    value as InteriorDesignConfigV1["conversionLogic"],
                                })
                              }
                            />
                          </>
                        ) : null}
                        {showEditorSection("scene") ? (
                          <>
                            <OptionSelect
                              label="空间类型"
                              value={config.scene.spaceType}
                              options={SPACE_TYPE_OPTIONS}
                              onChange={(value) =>
                                patchScene({ spaceType: value })
                              }
                            />
                            <OptionSelect
                              label="设计风格"
                              value={config.scene.designStyle}
                              options={DESIGN_STYLE_OPTIONS}
                              onChange={(value) =>
                                patchScene({ designStyle: value })
                              }
                            />
                            <OptionSelect
                              label="外景类型"
                              value={config.scene.exteriorView}
                              options={EXTERIOR_VIEW_OPTIONS}
                              onChange={(value) =>
                                patchScene({ exteriorView: value })
                              }
                            />
                            <OptionSelect
                              label="地点"
                              value={config.scene.location}
                              options={LOCATION_OPTIONS}
                              disabled={isEnclosed}
                              onChange={(value) =>
                                patchScene({ location: value })
                              }
                            />
                          </>
                        ) : null}
                        {showEditorSection("lighting") ? (
                          <>
                            <OptionSelect
                              label="光照预设"
                              value={config.presetId}
                              options={INTERIOR_PRESETS.map((p) => ({
                                id: p.id,
                                label: p.label,
                                prompt: p.description,
                              }))}
                              onChange={choosePreset}
                            />
                            <OptionSelect
                              label="季节"
                              value={config.lighting.season}
                              options={SEASON_OPTIONS}
                              onChange={(value) =>
                                patchLighting({ season: value })
                              }
                            />
                            <OptionSelect
                              label="天气"
                              value={config.lighting.weather}
                              options={WEATHER_OPTIONS}
                              onChange={(value) =>
                                patchLighting({ weather: value })
                              }
                            />
                            <OptionSelect
                              label="时间"
                              value={config.lighting.timeOfDay}
                              options={TIME_OPTIONS}
                              onChange={(value) =>
                                patchLighting({ timeOfDay: value })
                              }
                            />
                            <OptionSelect
                              label="室内灯光"
                              value={config.lighting.interiorLight}
                              options={INTERIOR_LIGHT_OPTIONS}
                              onChange={(value) =>
                                patchLighting({ interiorLight: value })
                              }
                            />
                            <OptionSelect
                              label="窗帘类型"
                              value={config.lighting.curtainType}
                              options={CURTAIN_OPTIONS}
                              disabled={isEnclosed}
                              onChange={(value) =>
                                patchLighting({ curtainType: value })
                              }
                            />
                            <OptionSelect
                              label="进光方向"
                              value={config.lighting.lightEntryMode}
                              options={LIGHT_ENTRY_MODE_OPTIONS}
                              onChange={(value) =>
                                patchLighting({
                                  lightEntryMode:
                                    value as InteriorDesignConfigV1["lighting"]["lightEntryMode"],
                                })
                              }
                            />
                            <OptionSelect
                              label="太阳光影"
                              value={config.lighting.sunlightEffect}
                              options={SUNLIGHT_OPTIONS}
                              disabled={
                                config.lighting.lightEntryMode === "disabled"
                              }
                              onChange={(value) =>
                                patchLighting({ sunlightEffect: value })
                              }
                            />
                            <OptionSelect
                              label="室内灯光色温"
                              value={config.lighting.colorTemperature}
                              options={COLOR_TEMPERATURE_OPTIONS}
                              disabled={
                                config.lighting.interiorLight === "natural-only"
                              }
                              onChange={(value) =>
                                patchLighting({ colorTemperature: value })
                              }
                            />
                            <OptionSelect
                              label="后期色调"
                              value={config.lighting.colorGrading}
                              options={COLOR_GRADING_OPTIONS}
                              onChange={(value) =>
                                patchLighting({ colorGrading: value })
                              }
                            />
                            <OptionSelect
                              label="光影品质"
                              value={config.lighting.tonalQuality}
                              options={TONAL_QUALITY_OPTIONS}
                              onChange={(value) =>
                                patchLighting({ tonalQuality: value })
                              }
                            />
                            <OptionSelect
                              label="人物、宠物配置"
                              value={config.lighting.occupants}
                              options={OCCUPANT_OPTIONS}
                              onChange={(value) =>
                                patchLighting({ occupants: value })
                              }
                            />
                          </>
                        ) : null}
                        {showEditorSection("output") ? (
                          <>
                            <OptionSelect
                              label="画面比例"
                              value={config.output.aspectRatio}
                              options={ASPECT_RATIO_OPTIONS}
                              onChange={(value) =>
                                patchOutput({
                                  aspectRatio:
                                    value as InteriorDesignConfigV1["output"]["aspectRatio"],
                                })
                              }
                            />
                            <OptionSelect
                              label="提示词清晰度"
                              value={config.output.promptResolution}
                              options={PROMPT_RESOLUTION_OPTIONS}
                              onChange={(value) =>
                                patchOutput({
                                  promptResolution:
                                    value as InteriorDesignConfigV1["output"]["promptResolution"],
                                })
                              }
                            />
                            <label className={`${labelClass} col-span-2`}>
                              <span>自定义需求</span>
                              <textarea
                                className={`${controlClass} min-h-28 resize-y py-2.5`}
                                value={config.customRequirement}
                                onChange={(event) =>
                                  patchConfig({
                                    customRequirement: event.target.value,
                                  })
                                }
                              />
                            </label>
                          </>
                        ) : null}
                        {showEditorSection("photography") ? (
                          <>
                            <OptionSelect
                              label="相机"
                              value={config.photography.camera}
                              options={CAMERA_OPTIONS}
                              onChange={(value) =>
                                patchPhotography({ camera: value })
                              }
                            />
                            <OptionSelect
                              label="焦距"
                              value={config.photography.focalLength}
                              options={FOCAL_LENGTH_OPTIONS}
                              onChange={(value) =>
                                patchPhotography({ focalLength: value })
                              }
                            />
                            <OptionSelect
                              label="光圈"
                              value={config.photography.aperture}
                              options={APERTURE_OPTIONS}
                              onChange={(value) =>
                                patchPhotography({ aperture: value })
                              }
                            />
                            <OptionSelect
                              label="快门"
                              value={config.photography.shutterSpeed}
                              options={SHUTTER_OPTIONS}
                              onChange={(value) =>
                                patchPhotography({ shutterSpeed: value })
                              }
                            />
                            <OptionSelect
                              label="ISO"
                              value={config.photography.iso}
                              options={ISO_OPTIONS}
                              onChange={(value) =>
                                patchPhotography({ iso: value })
                              }
                            />
                            <div className="col-span-2 space-y-1 text-[10px] text-[var(--text-muted)]">
                              <span>摄影技法（可多选）</span>
                              <div className="flex flex-wrap gap-1.5">
                                {TECHNIQUE_OPTIONS.map((item) => {
                                  const checked =
                                    config.photography.techniques.includes(
                                      item.id,
                                    );
                                  return (
                                    <label
                                      key={item.id}
                                      title={item.prompt}
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
                                              : [
                                                  ...config.photography
                                                    .techniques,
                                                  item.id,
                                                ],
                                          })
                                        }
                                      />
                                      {item.label}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </>
                        ) : null}
                        {showEditorSection("constraints") ? (
                          <>
                            <OptionSelect
                              label="几何保真"
                              value={config.constraints.geometryFidelity}
                              options={GEOMETRY_OPTIONS}
                              onChange={(value) =>
                                patchConstraints({ geometryFidelity: value })
                              }
                            />
                            <OptionSelect
                              label="物体一致性"
                              value={config.constraints.objectConsistency}
                              options={OBJECT_OPTIONS}
                              onChange={(value) =>
                                patchConstraints({ objectConsistency: value })
                              }
                            />
                            <div className="col-span-2">
                              <OptionSelect
                                label="材质一致性"
                                value={config.constraints.materialConsistency}
                                options={MATERIAL_OPTIONS}
                                onChange={(value) =>
                                  patchConstraints({
                                    materialConsistency: value,
                                  })
                                }
                              />
                            </div>
                            <label className={`${labelClass} col-span-2`}>
                              <span>材质精准定义</span>
                              <ol className="grid grid-cols-3 gap-1.5 text-[9px] leading-4 text-[var(--text-muted)]">
                                <li className="rounded border border-[var(--border-subtle)] p-1.5">
                                  1. 复制识别提示词
                                </li>
                                <li className="rounded border border-[var(--border-subtle)] p-1.5">
                                  2. 用任意视觉模型分析
                                </li>
                                <li className="rounded border border-[var(--border-subtle)] p-1.5">
                                  3. 粘贴完整结果
                                </li>
                              </ol>
                              <button
                                type="button"
                                className="nodrag inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent-violet-muted)] hover:text-[var(--text-primary)]"
                                title={MATERIAL_IDENTIFICATION_GUIDANCE}
                                onClick={copyMaterialGuidance}
                              >
                                {materialGuidanceCopied ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                {materialGuidanceCopied
                                  ? "已复制材质识别提示词"
                                  : "复制材质识别提示词"}
                              </button>
                              <textarea
                                className={`${controlClass} min-h-36 resize-y py-2.5 font-mono`}
                                value={materialDraft}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  materialDraftRef.current = value;
                                  setMaterialDraft(value);
                                  try {
                                    setMaterialError("");
                                    patchConstraints({
                                      materialDefinition:
                                        parseInteriorMaterialDefinition(value),
                                    });
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
                                <span className="text-red-400">
                                  {materialError}
                                </span>
                              ) : null}
                            </label>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <details className="group nodrag border-t border-[var(--border-subtle)] pt-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold text-[var(--text-secondary)]">
                      <span>专业参数说明</span>
                      <Info className="h-3.5 w-3.5" />
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {PROFESSIONAL_HELP.map(([title, content]) => (
                        <div
                          key={title}
                          className="rounded border border-[var(--border-subtle)] bg-[var(--control-bg)] p-2"
                        >
                          <strong className="text-[10px] text-[var(--text-primary)]">
                            {title}
                          </strong>
                          <p className="mt-1 text-[9px] leading-4 text-[var(--text-muted)]">
                            {content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                  <details className="group nodrag border-t border-[var(--border-subtle)] pt-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold text-[var(--text-secondary)]">
                      <span>实时 JSON 预览</span>
                      <Braces className="h-3.5 w-3.5" />
                    </summary>
                    <pre className="nowheel mt-2 max-h-48 overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--control-bg)] p-3 text-[9px] leading-4 whitespace-pre-wrap text-[var(--text-secondary)]">
                      {data.compiledPrompt}
                    </pre>
                    <button
                      type="button"
                      className={`${themeClasses.nodeActionButton} mt-2 h-8 w-full text-[10px]`}
                      onClick={copyCompiledPrompt}
                    >
                      {jsonCopied ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      {jsonCopied ? "已复制 JSON" : "复制 JSON"}
                    </button>
                  </details>
                  <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
                    <button
                      type="button"
                      className={`${themeClasses.nodeActionButton} h-9 flex-1 text-[11px]`}
                      onClick={() => setEditorOpen(false)}
                    >
                      完成
                    </button>
                    <button
                      type="button"
                      className={`${themeClasses.nodePrimaryButton} h-9 flex-1 gap-2 text-[11px]`}
                      disabled={blockingIssues.length > 0}
                      onClick={() => {
                        setEditorOpen(false);
                        runTracked(() => materializeInteriorDesignPrompt(id));
                      }}
                    >
                      <FileOutput className="h-3.5 w-3.5" />
                      输出提示词
                    </button>
                  </div>
                </aside>
              </div>,
              document.body,
            )
          : null}
      </div>
    </CustomSelectionContext.Provider>
  );
});
