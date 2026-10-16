import type { GptImageBackground, GptImageQuality } from "@/types";
import {
  DEFAULT_GENERATE_RATIO,
  SUPPORTED_GENERATE_RATIOS,
  normalizeGenerateOutputCount,
  normalizeGptImageBackground,
} from "@/constants/generateNode";

export const RATIOS = [DEFAULT_GENERATE_RATIO, ...SUPPORTED_GENERATE_RATIOS];
export const RESOLUTIONS = ["1K", "2K", "4K"];
export const GPT_IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export const GPT_IMAGE_QUALITY_LABELS: Record<GptImageQuality, string> = {
  auto: "自动",
  low: "快速",
  medium: "均衡",
  high: "高质",
};
export const GPT_IMAGE_BACKGROUND_LABELS: Record<GptImageBackground, string> = {
  auto: "自动",
  opaque: "不透明",
  transparent: "透明",
};

export function getRatioLabel(ratio: string) {
  return ratio === "Auto" ? "自动" : ratio;
}

export function getResolutionLabel(resolution: string) {
  return resolution;
}

const PROMPT_RATIO_PATTERN =
  /(?:^|[^\d])(\d{1,4})\s*[:x]\s*(\d{1,4})(?:[^\d]|$)/i;

export function hasPromptRatio(prompt: string) {
  return PROMPT_RATIO_PATTERN.test(prompt);
}

export function shouldShowResolutionSettings(
  isGptImageModel: boolean,
  ratio: string,
  hasAutoRatioSource = false,
) {
  return (
    !isGptImageModel || ratio !== DEFAULT_GENERATE_RATIO || hasAutoRatioSource
  );
}

export function getGenerateSettingsSummary({
  isGptImageModel,
  ratio,
  resolution,
  quality,
  hasAutoRatioSource = false,
  outputCount = 1,
  background = "auto",
  showBackgroundSettings = false,
}: {
  isGptImageModel: boolean;
  ratio: string;
  resolution: string;
  quality: GptImageQuality;
  hasAutoRatioSource?: boolean;
  outputCount?: number;
  background?: GptImageBackground;
  showBackgroundSettings?: boolean;
}) {
  const summary = [getRatioLabel(ratio)];
  if (shouldShowResolutionSettings(isGptImageModel, ratio, hasAutoRatioSource))
    summary.push(getResolutionLabel(resolution));
  if (isGptImageModel) summary.push(GPT_IMAGE_QUALITY_LABELS[quality]);
  const normalizedBackground = normalizeGptImageBackground(background);
  if (showBackgroundSettings && normalizedBackground !== "auto")
    summary.push(GPT_IMAGE_BACKGROUND_LABELS[normalizedBackground]);
  summary.push(`${normalizeGenerateOutputCount(outputCount)} 张`);
  return summary.join(" / ");
}
