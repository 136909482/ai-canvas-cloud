import type {
  GenerationFailureCategory,
  GenerationTelemetryCategory,
} from "./generationTelemetry.js";

export type GenerationTaskRecordStatus = "succeeded" | "failed" | "canceled";

export interface GenerationTaskRecordSummary {
  id: string;
  clientTaskId: string;
  title: string;
  category: GenerationTelemetryCategory;
  status: GenerationTaskRecordStatus;
  failureCategory: GenerationFailureCategory | null;
  resultCount: number;
  durationMs: number;
  modelEntryId: string | null;
  assetIds: string[];
  startedAt: string;
  completedAt: string;
}

export interface CreateGenerationTaskRecordRequest {
  clientTaskId: string;
  title: string;
  category: GenerationTelemetryCategory;
  status: GenerationTaskRecordStatus;
  failureCategory?: GenerationFailureCategory | null;
  resultCount?: number;
  durationMs: number;
  modelEntryId?: string | null;
  assetIds?: string[];
  startedAt: string;
  completedAt: string;
}

export interface GenerationTaskRecordsResponse {
  items: GenerationTaskRecordSummary[];
  nextCursor: string | null;
}
