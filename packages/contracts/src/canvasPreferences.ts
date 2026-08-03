export const canvasAutosaveIntervals = [
  15_000, 30_000, 60_000, 120_000, 300_000,
] as const;

export type CanvasAutosaveInterval = (typeof canvasAutosaveIntervals)[number];
export type CanvasThemeMode = "dark" | "light" | "system";
export type CanvasPerformanceMode = "quality" | "performance";
export type CanvasEdgeStyle = "animated" | "solid" | "step" | "smoothstep";

export interface CanvasPreferences {
  autosaveIntervalMs: CanvasAutosaveInterval;
  canvasTopBarCollapsed: boolean;
  alignmentGuidesEnabled: boolean;
  incomingEdgeAnimationEnabled: boolean;
  themeMode: CanvasThemeMode;
  canvasPerformanceMode: CanvasPerformanceMode;
  canvasGridEnabled: boolean;
  edgeStyle: CanvasEdgeStyle;
  lowQualityPreviewEnabled: boolean;
}

export type UpdateCanvasPreferencesRequest = Partial<CanvasPreferences>;

export interface CanvasPreferencesResponse {
  settings: CanvasPreferences | null;
  updatedAt: string | null;
}

export const DEFAULT_CANVAS_PREFERENCES: CanvasPreferences = {
  autosaveIntervalMs: 60_000,
  canvasTopBarCollapsed: false,
  alignmentGuidesEnabled: true,
  incomingEdgeAnimationEnabled: true,
  themeMode: "dark",
  canvasPerformanceMode: "quality",
  canvasGridEnabled: true,
  edgeStyle: "animated",
  lowQualityPreviewEnabled: true,
};
