import {
  APERTURE_OPTIONS,
  ASPECT_RATIO_OPTIONS,
  CAMERA_OPTIONS,
  COLOR_GRADING_OPTIONS,
  COLOR_TEMPERATURE_OPTIONS,
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
  InteriorDesignConfigV1,
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

function cloneConfig(input: InteriorDesignConfigV1): InteriorDesignConfigV1 {
  return structuredClone(input);
}

export function normalizeInteriorDesignConfig(
  input: InteriorDesignConfigV1,
): InteriorConfigValidationResult {
  const config = cloneConfig(input);
  const errors: string[] = [];

  config.schemaVersion = 1;
  config.customSourceSoftware = config.customSourceSoftware.trim().slice(0, 80);
  config.customRequirement = config.customRequirement.trim().slice(0, 2000);

  if (config.sourceSoftware === "custom" && !config.customSourceSoftware) {
    errors.push("请填写模型图来源软件");
  }

  if (ENCLOSED_SPACE_TYPES.has(config.scene.spaceType)) {
    config.scene.exteriorView = "enclosed";
    config.scene.location = "enclosed";
    config.lighting.curtainType = "none";
    config.lighting.lightEntryEnabled = false;
    config.lighting.sunlightEffect = "none";
    if (config.lighting.interiorLight === "natural-only") {
      config.lighting.interiorLight = "enclosed";
    }
  }

  if (!config.lighting.lightEntryEnabled) {
    config.lighting.sunlightEffect = "none";
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

  return { config, errors };
}

export function parseInteriorMaterialDefinition(
  input: string,
): InteriorMaterialDefinition {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) return trimmed.slice(0, 4000);

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("材质精准定义必须是 JSON 对象");
  }
  const output: Record<string, string> = {};
  for (const [key, itemValue] of Object.entries(parsed)) {
    if (typeof itemValue !== "string") {
      throw new Error("材质精准定义的每个值都必须是字符串");
    }
    output[key] = itemValue;
  }
  return output;
}

export function getInteriorProviderRatio(
  aspectRatio: InteriorDesignConfigV1["output"]["aspectRatio"],
) {
  return aspectRatio === "original" ? "Auto" : aspectRatio;
}

export function compileInteriorDesignPrompt(
  input: InteriorDesignConfigV1,
): string {
  const { config } = normalizeInteriorDesignConfig(input);
  const source =
    config.sourceSoftware === "custom"
      ? config.customSourceSoftware
      : value(SOURCE_SOFTWARE_OPTIONS, config.sourceSoftware);
  const conversionGoal = value(CONVERSION_GOAL_OPTIONS, config.conversionGoal);
  const techniques = config.photography.techniques.map((id) =>
    value(TECHNIQUE_OPTIONS, id),
  );

  const output = {
    图生图任务指令: {
      图生图任务: `将${source}转换为${config.conversionGoal === "photoreal-photo" ? "真实室内摄影照片" : "写实商业效果图"}`,
      转换逻辑: conversionGoal,
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
      进光口控制: config.lighting.lightEntryEnabled
        ? "仅允许从模型中真实存在的门窗进光，光线方向必须与开口位置一致，禁止凭空补光"
        : "关闭自然进光，禁止添加不存在的窗户、天窗或室外光源",
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

  return JSON.stringify(output, null, 2);
}

export function createDefaultInteriorDesignConfig() {
  return cloneConfig(DEFAULT_INTERIOR_CONFIG);
}
