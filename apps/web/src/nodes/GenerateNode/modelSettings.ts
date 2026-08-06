import type { GptImageQuality } from "@/types";
import {
  DEFAULT_GENERATE_RATIO,
  SUPPORTED_GENERATE_RATIOS,
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
}: {
  isGptImageModel: boolean;
  ratio: string;
  resolution: string;
  quality: GptImageQuality;
  hasAutoRatioSource?: boolean;
}) {
  const ratioLabel = getRatioLabel(ratio);
  if (!isGptImageModel)
    return `${ratioLabel} / ${getResolutionLabel(resolution)}`;
  if (ratio === DEFAULT_GENERATE_RATIO) {
    if (hasAutoRatioSource) {
      return `${ratioLabel} / ${getResolutionLabel(resolution)} / ${GPT_IMAGE_QUALITY_LABELS[quality]}`;
    }
    return `${ratioLabel} / ${GPT_IMAGE_QUALITY_LABELS[quality]}`;
  }
  return `${ratioLabel} / ${getResolutionLabel(resolution)} / ${GPT_IMAGE_QUALITY_LABELS[quality]}`;
}
