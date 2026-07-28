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
