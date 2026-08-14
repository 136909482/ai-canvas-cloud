import {
  APERTURE_OPTIONS,
  ASPECT_RATIO_OPTIONS,
  CAMERA_OPTIONS,
  COLOR_GRADING_OPTIONS,
  COLOR_TEMPERATURE_OPTIONS,
  CONVERSION_LOGIC_OPTIONS,
  CONVERSION_GOAL_OPTIONS,
  CURTAIN_OPTIONS,
  DEFAULT_INTERIOR_CONFIG,
  DESIGN_STYLE_OPTIONS,
  EXTERIOR_VIEW_OPTIONS,
  FOCAL_LENGTH_OPTIONS,
  GEOMETRY_OPTIONS,
  INTERIOR_LIGHT_OPTIONS,
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
  findInteriorOption,
} from "./catalog";
import type {
  InteriorConfigValidationResult,
  InteriorDesignConfigV2,
  InteriorMaterialDefinition,
  InteriorOption,
} from "./types";

const ENCLOSED_SPACE_TYPES = new Set([
  "basement-enclosed",
  "commercial-enclosed",
]);

function value(options: InteriorOption[], id: string) {
  return findInteriorOption(options, id).prompt;
}

function cloneConfig(input: unknown): InteriorDesignConfigV2 {
  const candidate = structuredClone(
    input ?? {},
  ) as Partial<InteriorDesignConfigV2> & {
    lighting?: Partial<InteriorDesignConfigV2["lighting"]> & {
      lightEntryEnabled?: boolean;
    };
  };
  const defaults = structuredClone(DEFAULT_INTERIOR_CONFIG);
  const legacyLightEntry = candidate.lighting?.lightEntryEnabled;
  return {
    ...defaults,
    ...candidate,
    schemaVersion: 2,
    scene: { ...defaults.scene, ...(candidate.scene ?? {}) },
    lighting: {
      ...defaults.lighting,
      ...(candidate.lighting ?? {}),
      lightEntryMode:
        candidate.lighting?.lightEntryMode ??
        (legacyLightEntry === false ? "disabled" : "detected-window"),
    },
    photography: { ...defaults.photography, ...(candidate.photography ?? {}) },
    constraints: { ...defaults.constraints, ...(candidate.constraints ?? {}) },
    output: { ...defaults.output, ...(candidate.output ?? {}) },
    customSelections: { ...(candidate.customSelections ?? {}) },
  };
}

function getLightEntryPrompt(config: InteriorDesignConfigV2) {
  const prompts: Record<
    InteriorDesignConfigV2["lighting"]["lightEntryMode"],
    string
  > = {
    "detected-window":
      "仅允许从模型中真实存在的门窗进光，光线方向必须与开口位置一致，禁止凭空补光",
    "forced-left":
      "画面左侧为唯一自然主光方向，形成从左向右的稳定环境光，禁止右侧、顶部和正面补光",
    "forced-right":
      "画面右侧为唯一自然主光方向，形成从右向左的稳定环境光，禁止左侧、顶部和正面补光",
    "forced-rear":
      "画面正后方为唯一自然主光方向，形成由后向前的稳定环境光，禁止两侧、顶部和正面补光",
    disabled: "关闭自然进光，禁止添加不存在的窗户、天窗或室外光源",
    custom:
      config.customSelections["lighting.lightEntryMode"] ||
      "按照用户指定的方向和范围控制自然进光",
  };
  return prompts[config.lighting.lightEntryMode];
}

export function normalizeInteriorDesignConfig(
  input: unknown,
): InteriorConfigValidationResult {
  const config = cloneConfig(input);
  const errors: string[] = [];
  const warnings: string[] = [];

  config.schemaVersion = 2;
  config.customSourceSoftware = config.customSourceSoftware.trim().slice(0, 80);
  config.customRequirement = config.customRequirement.trim().slice(0, 2000);
  config.conversionLogic ??=
    config.conversionGoal === "realistic-visualization"
      ? "realistic-visualization"
      : "pbr-photoreal";
  config.customSelections = Object.fromEntries(
    Object.entries(config.customSelections ?? {})
      .map(
        ([key, value]) =>
          [
            key.trim().slice(0, 80),
            String(value).trim().slice(0, 500),
          ] as const,
      )
      .filter(([key, value]) => key && value),
  );

  if (config.sourceSoftware === "custom" && !config.customSourceSoftware) {
    errors.push("请填写模型图来源软件");
  }

  if (ENCLOSED_SPACE_TYPES.has(config.scene.spaceType)) {
    config.scene.exteriorView = "enclosed";
    config.scene.location = "enclosed";
    config.lighting.curtainType = "none";
    if (config.lighting.lightEntryMode === "detected-window") {
      config.lighting.lightEntryMode = "disabled";
      config.lighting.sunlightEffect = "none";
    }
    if (config.lighting.interiorLight === "natural-only") {
      config.lighting.interiorLight = "enclosed";
    }
  }

  if (config.lighting.lightEntryMode === "disabled") {
    config.lighting.sunlightEffect = "none";
  }

  if (
    ["tyndall", "tree", "clean", "top-spots"].includes(
      config.lighting.sunlightEffect,
    )
  ) {
    config.lighting.weather = "sunny";
    if (config.lighting.lightEntryMode === "disabled") {
      config.lighting.lightEntryMode = "detected-window";
    }
  }
  if (["cloudy", "foggy", "rainy"].includes(config.lighting.weather)) {
    if (
      ["clean", "tree", "tyndall", "top-spots"].includes(
        config.lighting.sunlightEffect,
      )
    ) {
      config.lighting.sunlightEffect = "none";
    }
  }
  const curtainByEffect: Record<string, string> = {
    "shangri-la": "shangri-la",
    dream: "dream",
    sheer: "sheer-closed",
  };
  config.lighting.curtainType =
    curtainByEffect[config.lighting.sunlightEffect] ??
    config.lighting.curtainType;

  if (["iphone", "iphone17"].includes(config.photography.camera)) {
    config.photography.aperture = "phone-f1.6";
    config.photography.shutterSpeed = "1/60s";
    config.photography.iso = "50";
  }
  if (
    ["city-night", "night-shopfront"].includes(config.scene.exteriorView) &&
    !["night", "late-evening", "midnight", "late-night"].includes(
      config.lighting.timeOfDay,
    )
  ) {
    config.lighting.timeOfDay = "night";
  }
  const slowShutter = ["1s", "5s", "30s"].includes(
    config.photography.shutterSpeed,
  );
  if (config.photography.techniques.includes("hdr") && slowShutter) {
    warnings.push("HDR 包围曝光与慢快门同时使用，可能造成画面重影");
  }
  if (config.photography.techniques.includes("tripod") && !slowShutter) {
    warnings.push("三脚架长曝光通常需要 1 秒或更慢的快门");
  }
  if (config.lighting.occupants.includes("motion-person") && !slowShutter) {
    warnings.push("动态虚影人物需要慢快门才能形成自然拖影");
  }

  if (typeof config.constraints.materialDefinition === "string") {
    config.constraints.materialDefinition =
      config.constraints.materialDefinition.trim().slice(0, 4000);
  } else {
    const entries = Object.entries(config.constraints.materialDefinition);
    if (entries.length > 40) {
      errors.push("材质精准定义最多支持 40 个元素");
    }
    const normalized: Record<string, string> = {};
    for (const [rawKey, rawValue] of entries.slice(0, 40)) {
      const key = rawKey.trim().slice(0, 80);
      const itemValue = String(rawValue).trim().slice(0, 500);
      if (!key || !itemValue) {
        errors.push("材质精准定义不能包含空名称或空描述");
        continue;
      }
      normalized[key] = itemValue;
    }
    config.constraints.materialDefinition = normalized;
  }

  return { config, errors, warnings };
}

export function applyInteriorLightingPatch(
  input: InteriorDesignConfigV2,
  patch: Partial<InteriorDesignConfigV2["lighting"]>,
) {
  const next = cloneConfig(input);
  next.lighting = { ...next.lighting, ...patch };

  if (
    patch.sunlightEffect &&
    patch.sunlightEffect !== "none" &&
    next.lighting.lightEntryMode === "disabled"
  ) {
    next.lighting.lightEntryMode = "detected-window";
  }

  if (
    patch.weather &&
    ["cloudy", "foggy", "rainy"].includes(patch.weather) &&
    ["clean", "tree", "tyndall", "top-spots"].includes(
      next.lighting.sunlightEffect,
    )
  ) {
    next.lighting.sunlightEffect = "none";
  }
  if (
    patch.sunlightEffect &&
    ["clean", "tree", "tyndall", "top-spots"].includes(patch.sunlightEffect)
  ) {
    next.lighting.weather = "sunny";
    if (next.lighting.lightEntryMode === "disabled") {
      next.lighting.lightEntryMode = "detected-window";
    }
  }
  if (patch.lightEntryMode === "disabled") {
    next.lighting.sunlightEffect = "none";
  }
  return normalizeInteriorDesignConfig(next).config;
}

export function applyInteriorScenePatch(
  input: InteriorDesignConfigV2,
  patch: Partial<InteriorDesignConfigV2["scene"]>,
) {
  const next = cloneConfig(input);
  next.scene = { ...next.scene, ...patch };
  if (
    patch.exteriorView &&
    ["city-night", "night-shopfront"].includes(patch.exteriorView)
  ) {
    next.lighting.timeOfDay = "night";
  }
  return normalizeInteriorDesignConfig(next).config;
}

export function applyInteriorPhotographyPatch(
  input: InteriorDesignConfigV2,
  patch: Partial<InteriorDesignConfigV2["photography"]>,
) {
  const next = cloneConfig(input);
  next.photography = { ...next.photography, ...patch };
  if (patch.camera && ["iphone", "iphone17"].includes(patch.camera)) {
    next.photography.aperture = "phone-f1.6";
    next.photography.shutterSpeed = "1/60s";
    next.photography.iso = "50";
  }
  return normalizeInteriorDesignConfig(next).config;
}

export function parseInteriorMaterialDefinition(
  input: string,
): InteriorMaterialDefinition {
  const trimmed = input.trim();
  const jsonText = extractMaterialJson(trimmed);
  if (!jsonText) return trimmed.slice(0, 4000);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    try {
      parsed = JSON.parse(removeJsonTrailingCommas(jsonText));
    } catch {
      throw new Error(
        "未能识别材质内容，请直接粘贴完整结果，系统会自动处理常见格式问题",
      );
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("材质内容需要是按区域分类的对象");
  }

  const output: Record<string, string> = {};
  for (const [category, categoryValue] of Object.entries(parsed)) {
    if (typeof categoryValue === "string") {
      output[category] = categoryValue;
      continue;
    }
    if (!Array.isArray(categoryValue)) {
      throw new Error(`“${category}”中的材质内容格式不正确`);
    }
    for (const item of categoryValue) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`“${category}”中存在无法识别的材质条目`);
      }
      const fields = item as Record<string, unknown>;
      const name = fields["元素名称"];
      if (typeof name !== "string" || !name.trim()) {
        throw new Error(`“${category}”中有材质条目缺少元素名称`);
      }
      const description = ["材质类型", "质感描述", "表面特征", "反光特性"]
        .map((field) => fields[field])
        .filter((value): value is string =>
          Boolean(typeof value === "string" && value.trim()),
        )
        .map((value) => value.trim())
        .join("；");
      if (!description) {
        throw new Error(`“${name}”缺少材质描述`);
      }
      output[`${category} / ${name.trim()}`] = description;
    }
  }
  return output;
}

function extractMaterialJson(input: string) {
  const withoutFence = input
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  return start >= 0 && end > start ? withoutFence.slice(start, end + 1) : "";
}

function removeJsonTrailingCommas(input: string) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ",") {
      let next = index + 1;
      while (next < input.length && /\s/.test(input[next])) next += 1;
      if (input[next] === "}" || input[next] === "]") continue;
    }
    output += character;
  }
  return output;
}

export function getInteriorProviderRatio(
  aspectRatio: InteriorDesignConfigV2["output"]["aspectRatio"],
) {
  return aspectRatio === "original" || aspectRatio === "custom"
    ? "Auto"
    : aspectRatio;
}

export function compileInteriorDesignPrompt(
  input: InteriorDesignConfigV2,
): string {
  const { config } = normalizeInteriorDesignConfig(input);
  const source =
    config.sourceSoftware === "custom"
      ? config.customSourceSoftware
      : value(SOURCE_SOFTWARE_OPTIONS, config.sourceSoftware);
  const conversionGoal = value(CONVERSION_GOAL_OPTIONS, config.conversionGoal);
  const conversionLogic =
    config.conversionLogic === "custom"
      ? config.customSelections.conversionLogic ||
        value(CONVERSION_LOGIC_OPTIONS, config.conversionLogic)
      : value(CONVERSION_LOGIC_OPTIONS, config.conversionLogic);
  const techniques = config.photography.techniques.map((id) =>
    value(TECHNIQUE_OPTIONS, id),
  );

  const output = {
    图生图任务指令: {
      图生图任务:
        config.conversionGoal === "custom"
          ? config.customSelections.conversionGoal || conversionGoal
          : `将${source}转换为${config.conversionGoal === "photoreal-photo" ? "真实室内摄影照片" : "写实商业效果图"}`,
      转换逻辑: conversionLogic,
    },
    场景类型: {
      空间类型: value(SPACE_TYPE_OPTIONS, config.scene.spaceType),
      设计风格: value(DESIGN_STYLE_OPTIONS, config.scene.designStyle),
      外景类型: value(EXTERIOR_VIEW_OPTIONS, config.scene.exteriorView),
      地点: value(LOCATION_OPTIONS, config.scene.location),
    },
    光影氛围类型: {
      季节: value(SEASON_OPTIONS, config.lighting.season),
      天气: value(WEATHER_OPTIONS, config.lighting.weather),
      时间段: value(TIME_OPTIONS, config.lighting.timeOfDay),
      窗帘类型: value(CURTAIN_OPTIONS, config.lighting.curtainType),
      进光口控制: getLightEntryPrompt(config),
      太阳光光影: value(SUNLIGHT_OPTIONS, config.lighting.sunlightEffect),
      室内光: value(INTERIOR_LIGHT_OPTIONS, config.lighting.interiorLight),
      室内灯光色温: value(
        COLOR_TEMPERATURE_OPTIONS,
        config.lighting.colorTemperature,
      ),
      后期色调: value(COLOR_GRADING_OPTIONS, config.lighting.colorGrading),
      光影品质: value(TONAL_QUALITY_OPTIONS, config.lighting.tonalQuality),
      人物宠物配置: value(OCCUPANT_OPTIONS, config.lighting.occupants),
    },
    摄影参数: {
      相机型号: value(CAMERA_OPTIONS, config.photography.camera),
      光圈: value(APERTURE_OPTIONS, config.photography.aperture),
      快门速度: value(SHUTTER_OPTIONS, config.photography.shutterSpeed),
      ISO: value(ISO_OPTIONS, config.photography.iso),
      全画幅等效焦距: value(
        FOCAL_LENGTH_OPTIONS,
        config.photography.focalLength,
      ),
      拍摄技法: techniques,
    },
    核心约束: {
      几何保真度: value(GEOMETRY_OPTIONS, config.constraints.geometryFidelity),
      物体完整一致性: value(
        OBJECT_OPTIONS,
        config.constraints.objectConsistency,
      ),
      材质完整一致性: value(
        MATERIAL_OPTIONS,
        config.constraints.materialConsistency,
      ),
      材质精准定义: config.constraints.materialDefinition,
    },
    出图参数: {
      出图比例: value(ASPECT_RATIO_OPTIONS, config.output.aspectRatio),
      分辨率: value(PROMPT_RESOLUTION_OPTIONS, config.output.promptResolution),
      ...(config.customRequirement
        ? { 补充要求: config.customRequirement }
        : {}),
    },
  };

  const customAliases: Record<string, string[]> = {
    "lighting.timeOfDay": ["时间"],
    "lighting.interiorLight": ["室内灯光"],
    "photography.camera": ["相机"],
    "photography.focalLength": ["焦距"],
    "photography.aperture": ["光圈"],
    "photography.shutterSpeed": ["快门"],
    "photography.iso": ["ISO"],
  };
  const customText = (path: string, fallback: string) =>
    config.customSelections[path] ||
    customAliases[path]
      ?.map((alias) => config.customSelections[alias])
      .find(Boolean) ||
    fallback;
  const replaceCustom = (selected: string, path: string, fallback: string) =>
    selected === "custom" ? customText(path, fallback) : fallback;

  output.场景类型.空间类型 = replaceCustom(
    config.scene.spaceType,
    "scene.spaceType",
    output.场景类型.空间类型,
  );
  output.场景类型.设计风格 = replaceCustom(
    config.scene.designStyle,
    "scene.designStyle",
    output.场景类型.设计风格,
  );
  output.场景类型.外景类型 = replaceCustom(
    config.scene.exteriorView,
    "scene.exteriorView",
    output.场景类型.外景类型,
  );
  output.场景类型.地点 = replaceCustom(
    config.scene.location,
    "scene.location",
    output.场景类型.地点,
  );

  output.光影氛围类型.季节 = replaceCustom(
    config.lighting.season,
    "lighting.season",
    output.光影氛围类型.季节,
  );
  output.光影氛围类型.天气 = replaceCustom(
    config.lighting.weather,
    "lighting.weather",
    output.光影氛围类型.天气,
  );
  output.光影氛围类型.时间段 = replaceCustom(
    config.lighting.timeOfDay,
    "lighting.timeOfDay",
    output.光影氛围类型.时间段,
  );
  output.光影氛围类型.窗帘类型 = replaceCustom(
    config.lighting.curtainType,
    "lighting.curtainType",
    output.光影氛围类型.窗帘类型,
  );
  output.光影氛围类型.太阳光光影 = replaceCustom(
    config.lighting.sunlightEffect,
    "lighting.sunlightEffect",
    output.光影氛围类型.太阳光光影,
  );
  output.光影氛围类型.室内光 = replaceCustom(
    config.lighting.interiorLight,
    "lighting.interiorLight",
    output.光影氛围类型.室内光,
  );
  output.光影氛围类型.室内灯光色温 = replaceCustom(
    config.lighting.colorTemperature,
    "lighting.colorTemperature",
    output.光影氛围类型.室内灯光色温,
  );
  output.光影氛围类型.后期色调 = replaceCustom(
    config.lighting.colorGrading,
    "lighting.colorGrading",
    output.光影氛围类型.后期色调,
  );
  output.光影氛围类型.光影品质 = replaceCustom(
    config.lighting.tonalQuality,
    "lighting.tonalQuality",
    output.光影氛围类型.光影品质,
  );
  output.光影氛围类型.人物宠物配置 = replaceCustom(
    config.lighting.occupants,
    "lighting.occupants",
    output.光影氛围类型.人物宠物配置,
  );

  output.摄影参数.相机型号 = replaceCustom(
    config.photography.camera,
    "photography.camera",
    output.摄影参数.相机型号,
  );
  output.摄影参数.光圈 = replaceCustom(
    config.photography.aperture,
    "photography.aperture",
    output.摄影参数.光圈,
  );
  output.摄影参数.快门速度 = replaceCustom(
    config.photography.shutterSpeed,
    "photography.shutterSpeed",
    output.摄影参数.快门速度,
  );
  output.摄影参数.ISO = replaceCustom(
    config.photography.iso,
    "photography.iso",
    output.摄影参数.ISO,
  );
  output.摄影参数.全画幅等效焦距 = replaceCustom(
    config.photography.focalLength,
    "photography.focalLength",
    output.摄影参数.全画幅等效焦距,
  );
  output.摄影参数.拍摄技法 = output.摄影参数.拍摄技法.map((item, index) =>
    config.photography.techniques[index] === "custom"
      ? customText("photography.techniques", item)
      : item,
  );

  output.核心约束.几何保真度 = replaceCustom(
    config.constraints.geometryFidelity,
    "constraints.geometryFidelity",
    output.核心约束.几何保真度,
  );
  output.核心约束.物体完整一致性 = replaceCustom(
    config.constraints.objectConsistency,
    "constraints.objectConsistency",
    output.核心约束.物体完整一致性,
  );
  output.核心约束.材质完整一致性 = replaceCustom(
    config.constraints.materialConsistency,
    "constraints.materialConsistency",
    output.核心约束.材质完整一致性,
  );
  output.出图参数.出图比例 = replaceCustom(
    config.output.aspectRatio,
    "output.aspectRatio",
    output.出图参数.出图比例,
  );
  output.出图参数.分辨率 = replaceCustom(
    config.output.promptResolution,
    "output.promptResolution",
    output.出图参数.分辨率,
  );

  const customEntries = Object.entries(config.customSelections);
  if (customEntries.length > 0) {
    (output as Record<string, unknown>)["自定义参数"] =
      Object.fromEntries(customEntries);
  }

  return JSON.stringify(output, null, 2);
}

export function createDefaultInteriorDesignConfig() {
  return cloneConfig(DEFAULT_INTERIOR_CONFIG);
}
