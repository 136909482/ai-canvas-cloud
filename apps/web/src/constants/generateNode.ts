export const MAX_GENERATE_REFERENCE_IMAGES = 16;
export const DEFAULT_GENERATE_RATIO = "Auto";
export const GENERATE_OUTPUT_COUNTS = [1, 2, 4] as const;
export type GenerateOutputCount = (typeof GENERATE_OUTPUT_COUNTS)[number];
export const GPT_IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;

export function normalizeGptImageBackground(value: unknown) {
  return value === "opaque" || value === "transparent" ? value : "auto";
}

export function normalizeGenerateOutputCount(
  value: unknown,
): GenerateOutputCount {
  return GENERATE_OUTPUT_COUNTS.includes(value as GenerateOutputCount)
    ? (value as GenerateOutputCount)
    : 1;
}

export const SUPPORTED_GENERATE_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "3:1",
  "1:3",
  "21:9",
  "9:21",
] as const;

export type SupportedGenerateRatio = (typeof SUPPORTED_GENERATE_RATIOS)[number];

export function normalizeGenerateRatio(value: unknown) {
  return typeof value === "string" &&
    SUPPORTED_GENERATE_RATIOS.includes(value as SupportedGenerateRatio)
    ? value
    : DEFAULT_GENERATE_RATIO;
}
