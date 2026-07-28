import {
  EDITOR_COLOR_SWATCHES,
  MAX_BRUSH_SIZE,
  MAX_TEXT_SIZE,
  MIN_BRUSH_SIZE,
  MIN_TEXT_SIZE,
  type ToolMode,
} from "./runtime";

const IMAGE_EDITOR_PREFERENCES_SCHEMA_VERSION = 1;
const IMAGE_EDITOR_PREFERENCES_KEY_PREFIX =
  "ai-canvas-image-editor-preferences-v1:";
const DEFAULT_BRUSH_SIZE = 24;
const DEFAULT_TEXT_SIZE = 32;
const ANNOTATION_TOOL_MODES = new Set<ToolMode>([
  "select",
  "brush",
  "line",
  "rect",
  "ellipse",
  "text",
]);

interface DrawingPreferences {
  color: string;
  brushSize: number;
}

export interface ImageEditorPreferences {
  schemaVersion: typeof IMAGE_EDITOR_PREFERENCES_SCHEMA_VERSION;
  annotation: DrawingPreferences & {
    toolMode: ToolMode;
  };
  mask: DrawingPreferences;
  textSize: number;
}

export function createDefaultImageEditorPreferences(): ImageEditorPreferences {
  return {
    schemaVersion: IMAGE_EDITOR_PREFERENCES_SCHEMA_VERSION,
    annotation: {
      toolMode: "select",
      color: EDITOR_COLOR_SWATCHES[0],
      brushSize: DEFAULT_BRUSH_SIZE,
    },
    mask: {
      color: EDITOR_COLOR_SWATCHES[0],
      brushSize: DEFAULT_BRUSH_SIZE,
    },
    textSize: DEFAULT_TEXT_SIZE,
  };
}

function normalizeSize(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function normalizeColor(value: unknown, fallback: string) {
  return typeof value === "string" &&
    EDITOR_COLOR_SWATCHES.some((color) => color === value)
    ? value
    : fallback;
}

export function normalizeImageEditorPreferences(
  value: unknown,
): ImageEditorPreferences {
  const defaults = createDefaultImageEditorPreferences();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const candidate = value as Partial<ImageEditorPreferences>;
  if (candidate.schemaVersion !== IMAGE_EDITOR_PREFERENCES_SCHEMA_VERSION) {
    return defaults;
  }

  const annotation =
    candidate.annotation && typeof candidate.annotation === "object"
      ? candidate.annotation
      : defaults.annotation;
  const mask =
    candidate.mask && typeof candidate.mask === "object"
      ? candidate.mask
      : defaults.mask;

  return {
    schemaVersion: IMAGE_EDITOR_PREFERENCES_SCHEMA_VERSION,
    annotation: {
      toolMode: ANNOTATION_TOOL_MODES.has(annotation.toolMode)
        ? annotation.toolMode
        : defaults.annotation.toolMode,
      color: normalizeColor(annotation.color, defaults.annotation.color),
      brushSize: normalizeSize(
        annotation.brushSize,
        MIN_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        defaults.annotation.brushSize,
      ),
    },
    mask: {
      color: normalizeColor(mask.color, defaults.mask.color),
      brushSize: normalizeSize(
        mask.brushSize,
        MIN_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        defaults.mask.brushSize,
      ),
    },
    textSize: normalizeSize(
      candidate.textSize,
      MIN_TEXT_SIZE,
      MAX_TEXT_SIZE,
      defaults.textSize,
    ),
  };
}

function getImageEditorPreferencesKey(userId: string) {
  const normalizedUserId = userId.trim();
  return normalizedUserId
    ? `${IMAGE_EDITOR_PREFERENCES_KEY_PREFIX}${encodeURIComponent(normalizedUserId)}`
    : null;
}

export function readImageEditorPreferences(
  userId: string | null,
): ImageEditorPreferences {
  const key = userId ? getImageEditorPreferencesKey(userId) : null;
  if (!key || typeof window === "undefined") {
    return createDefaultImageEditorPreferences();
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw
      ? normalizeImageEditorPreferences(JSON.parse(raw) as unknown)
      : createDefaultImageEditorPreferences();
  } catch {
    return createDefaultImageEditorPreferences();
  }
}

export function writeImageEditorPreferences(
  userId: string | null,
  preferences: ImageEditorPreferences,
) {
  const key = userId ? getImageEditorPreferencesKey(userId) : null;
  if (!key || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      key,
      JSON.stringify(normalizeImageEditorPreferences(preferences)),
    );
  } catch {
    // Preference persistence is best effort; editing remains fully functional.
  }
}
