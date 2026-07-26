export const generationTelemetryCategories = [
  "text",
  "image",
  "video",
] as const;

export type GenerationTelemetryCategory =
  (typeof generationTelemetryCategories)[number];

export const generationTelemetryStatuses = [
  "started",
  "succeeded",
  "failed",
  "canceled",
] as const;

export type GenerationTelemetryStatus =
  (typeof generationTelemetryStatuses)[number];

export const generationFailureCategories = [
  "network",
  "authentication",
  "rate_limited",
  "upstream",
  "invalid_response",
  "asset_upload",
  "unknown",
] as const;

export type GenerationFailureCategory =
  (typeof generationFailureCategories)[number];

export type GenerationTelemetryRequest =
  | {
      attemptId: string;
      category: GenerationTelemetryCategory;
      status: "started";
    }
  | {
      attemptId: string;
      category: GenerationTelemetryCategory;
      status: "succeeded";
      durationMs: number;
      resultCount: number;
    }
  | {
      attemptId: string;
      category: GenerationTelemetryCategory;
      status: "failed";
      durationMs: number;
      failureCategory: GenerationFailureCategory;
    }
  | {
      attemptId: string;
      category: GenerationTelemetryCategory;
      status: "canceled";
      durationMs: number;
    };

export interface GenerationTelemetryResponse {
  accepted: true;
  attemptId: string;
  status: GenerationTelemetryStatus;
}
