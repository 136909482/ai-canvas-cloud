export type InteriorSourceSoftware =
  "sketchup" | "kujiale" | "3ds-max" | "existing-render" | "custom";

export type InteriorConversionGoal =
  "photoreal-photo" | "realistic-visualization";

export type InteriorPresetId =
  | "diffuse-daylight"
  | "natural-sunlight"
  | "mixed-lighting"
  | "tree-shadow"
  | "curtain-shadow"
  | "enclosed-artificial";

export type InteriorMaterialDefinition = string | Record<string, string>;

export interface InteriorSceneConfig {
  spaceType: string;
  designStyle: string;
  exteriorView: string;
  location: string;
}

export interface InteriorLightingConfig {
  season: string;
  weather: string;
  timeOfDay: string;
  curtainType: string;
  lightEntryEnabled: boolean;
  sunlightEffect: string;
  interiorLight: string;
  colorTemperature: string;
  colorGrading: string;
  tonalQuality: string;
  occupants: string;
}

export interface InteriorPhotographyConfig {
  camera: string;
  aperture: string;
  shutterSpeed: string;
  iso: string;
  focalLength: string;
  techniques: string[];
}

export interface InteriorConstraintConfig {
  geometryFidelity: string;
  objectConsistency: string;
  materialConsistency: string;
  materialDefinition: InteriorMaterialDefinition;
}

export interface InteriorOutputConfig {
  aspectRatio: "original" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  promptResolution: "4K" | "8K";
}

export interface InteriorDesignConfigV1 {
  schemaVersion: 1;
  presetId: InteriorPresetId;
  sourceSoftware: InteriorSourceSoftware;
  customSourceSoftware: string;
  conversionGoal: InteriorConversionGoal;
  scene: InteriorSceneConfig;
  lighting: InteriorLightingConfig;
  photography: InteriorPhotographyConfig;
  constraints: InteriorConstraintConfig;
  output: InteriorOutputConfig;
  customRequirement: string;
}

export interface InteriorOption<T extends string = string> {
  id: T;
  label: string;
  prompt: string;
}

export interface InteriorPreset {
  id: InteriorPresetId;
  label: string;
  description: string;
  config: InteriorDesignConfigV1;
}

export interface InteriorConfigValidationResult {
  config: InteriorDesignConfigV1;
  errors: string[];
}
