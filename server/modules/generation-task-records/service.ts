import {
  generationFailureCategories,
  generationTelemetryCategories,
  type CreateGenerationTaskRecordRequest,
  type GenerationFailureCategory,
  type GenerationTaskRecordSummary,
  type GenerationTaskRecordsResponse,
} from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import type { ProjectActor } from "../projects/service.js";
import type { WorkspaceAuthorizationService } from "../workspaces/authorization.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESULT_COUNT = 32;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;
const MAX_TITLE_LENGTH = 120;

export interface GenerationTaskRecordService {
  record(
    input: CreateGenerationTaskRecordRequest,
    actor: ProjectActor,
  ): Promise<{ accepted: true }>;
  listMine(
    actor: ProjectActor,
    cursor?: string | null,
  ): Promise<GenerationTaskRecordsResponse>;
}

interface TaskRecordRow {
  id: string;
  client_task_id: string;
  title: string;
  category: string;
  status: string;
  failure_category: string | null;
  result_count: number;
  duration_ms: number;
  model_entry_id: string | null;
  asset_ids: string[] | null;
  started_at: Date | string;
  completed_at: Date | string;
}

function validationError(message: string): never {
  throw new AuthServiceError({
    statusCode: 400,
    apiCode: "VALIDATION_FAILED",
    message,
  });
}

function requireRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    validationError("Generation task record must be an object");
  }
  return value as Record<string, unknown>;
}

const ALLOWED_INPUT_KEYS = new Set([
  "clientTaskId",
  "title",
  "category",
  "status",
  "failureCategory",
  "resultCount",
  "durationMs",
  "modelEntryId",
  "assetIds",
  "startedAt",
  "completedAt",
]);

function rejectUnknownKeys(value: Record<string, unknown>) {
  if (Object.keys(value).some((key) => !ALLOWED_INPUT_KEYS.has(key))) {
    validationError("Generation task record contains unsupported fields");
  }
}

function requireIso(value: unknown, field: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    validationError(`${field} must be an ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function normalizeUuidList(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RESULT_COUNT) {
    validationError("assetIds must contain at most 32 items");
  }
  const normalized = value.map((item) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      validationError("assetIds must contain UUIDs");
    }
    return item.toLowerCase();
  });
  return [...new Set(normalized)];
}

export function validateCreateGenerationTaskRecord(
  value: unknown,
): CreateGenerationTaskRecordRequest {
  const input = requireRecord(value);
  rejectUnknownKeys(input);
  if (
    typeof input.clientTaskId !== "string" ||
    !UUID_PATTERN.test(input.clientTaskId)
  ) {
    validationError("clientTaskId must be a UUID");
  }
  if (typeof input.title !== "string") {
    validationError("title must be a string");
  }
  const title = input.title.trim().replace(/\s+/gu, " ");
  if (!title || title.length > MAX_TITLE_LENGTH) {
    validationError("title must be 1 to 120 characters");
  }
  if (
    typeof input.category !== "string" ||
    !generationTelemetryCategories.includes(
      input.category as (typeof generationTelemetryCategories)[number],
    )
  ) {
    validationError("category is invalid");
  }
  const status = input.status;
  if (!["succeeded", "failed", "canceled"].includes(status as string)) {
    validationError("status is invalid");
  }
  if (
    status === "failed" &&
    (input.failureCategory === undefined || input.failureCategory === null)
  ) {
    validationError("failureCategory is required for failed status");
  }
  if (
    input.failureCategory !== undefined &&
    input.failureCategory !== null &&
    (typeof input.failureCategory !== "string" ||
      !generationFailureCategories.includes(
        input.failureCategory as (typeof generationFailureCategories)[number],
      ))
  ) {
    validationError("failureCategory is invalid");
  }
  const failureCategory =
    status === "failed"
      ? (input.failureCategory as GenerationFailureCategory)
      : null;
  const rawResultCount =
    input.resultCount === undefined ? null : input.resultCount;
  const resultCount = Number(
    rawResultCount ?? (status === "succeeded" ? 1 : 0),
  );
  if (
    !Number.isSafeInteger(resultCount) ||
    resultCount < 0 ||
    resultCount > MAX_RESULT_COUNT
  ) {
    validationError("resultCount is invalid");
  }
  if (status === "succeeded" && resultCount < 1) {
    validationError("resultCount must be at least 1 for succeeded status");
  }
  if (status !== "succeeded" && resultCount !== 0) {
    validationError("resultCount must be 0 for non-succeeded status");
  }
  const durationMs = Number(input.durationMs);
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0 ||
    durationMs > MAX_DURATION_MS
  ) {
    validationError("durationMs is invalid");
  }
  if (
    input.modelEntryId !== undefined &&
    input.modelEntryId !== null &&
    (typeof input.modelEntryId !== "string" ||
      !UUID_PATTERN.test(input.modelEntryId))
  ) {
    validationError("modelEntryId must be a UUID or null");
  }
  const startedAt = requireIso(input.startedAt, "startedAt");
  const completedAt = requireIso(input.completedAt, "completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    validationError("completedAt must not be before startedAt");
  }
  return {
    clientTaskId: input.clientTaskId.toLowerCase(),
    title,
    category: input.category as CreateGenerationTaskRecordRequest["category"],
    status: status as CreateGenerationTaskRecordRequest["status"],
    failureCategory,
    resultCount,
    durationMs,
    modelEntryId:
      typeof input.modelEntryId === "string"
        ? input.modelEntryId.toLowerCase()
        : null,
    assetIds: normalizeUuidList(input.assetIds),
    startedAt,
    completedAt,
  };
}

function toIso(value: Date | string) {
  return new Date(value).toISOString();
}

function recordSummary(row: TaskRecordRow): GenerationTaskRecordSummary {
  return {
    id: row.id,
    clientTaskId: row.client_task_id,
    title: row.title,
    category: row.category as GenerationTaskRecordSummary["category"],
    status: row.status as GenerationTaskRecordSummary["status"],
    failureCategory: row.failure_category as GenerationFailureCategory | null,
    resultCount: row.result_count,
    durationMs: row.duration_ms,
    modelEntryId: row.model_entry_id,
    assetIds: row.asset_ids ?? [],
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
  };
}

function decodeCursor(cursor?: string | null) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { completedAt?: unknown; id?: unknown };
    if (
      typeof parsed.completedAt !== "string" ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id) ||
      !Number.isFinite(Date.parse(parsed.completedAt))
    ) {
      throw new Error();
    }
    return {
      completedAt: new Date(parsed.completedAt).toISOString(),
      id: parsed.id,
    };
  } catch {
    validationError("Generation task record cursor is invalid");
  }
}

function encodeCursor(row: TaskRecordRow) {
  return Buffer.from(
    JSON.stringify({
      completedAt: toIso(row.completed_at),
      id: row.id,
    }),
  ).toString("base64url");
}

export function createUnavailableGenerationTaskRecordService(): GenerationTaskRecordService {
  const unavailable = async (): Promise<never> => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: "SERVICE_UNAVAILABLE",
      message: "Generation task record service is unavailable",
      retryable: true,
    });
  };
  return { record: unavailable, listMine: unavailable };
}

export function createPostgresGenerationTaskRecordService(
  pool: DbPool,
  options: { authorizationService: WorkspaceAuthorizationService },
): GenerationTaskRecordService {
  return {
    async record(rawInput, actor) {
      const input = validateCreateGenerationTaskRecord(rawInput);
      await options.authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      });

      await pool.query(
        `INSERT INTO generation_task_records (
           workspace_id, user_id, client_task_id, title, category, status,
           failure_category, result_count, duration_ms, model_entry_id,
           asset_ids, started_at, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (user_id, client_task_id) DO UPDATE
         SET workspace_id = EXCLUDED.workspace_id,
             title = EXCLUDED.title,
             category = EXCLUDED.category,
             status = EXCLUDED.status,
             failure_category = EXCLUDED.failure_category,
             result_count = EXCLUDED.result_count,
             duration_ms = EXCLUDED.duration_ms,
             model_entry_id = EXCLUDED.model_entry_id,
             asset_ids = EXCLUDED.asset_ids,
             started_at = EXCLUDED.started_at,
             completed_at = EXCLUDED.completed_at,
             updated_at = now()`,
        [
          actor.workspaceId,
          actor.userId,
          input.clientTaskId,
          input.title,
          input.category,
          input.status,
          input.failureCategory,
          input.resultCount,
          input.durationMs,
          input.modelEntryId,
          input.assetIds,
          input.startedAt,
          input.completedAt,
        ],
      );
      return { accepted: true };
    },

    async listMine(actor, cursorValue) {
      const cursor = decodeCursor(cursorValue);
      const values: unknown[] = [actor.userId];
      let cursorClause = "";
      if (cursor) {
        values.push(cursor.completedAt, cursor.id);
        cursorClause = `AND (completed_at, id) < ($2::timestamptz, $3::uuid)`;
      }
      values.push(51);
      const result = await pool.query<TaskRecordRow>(
        `SELECT id, client_task_id, title, category, status, failure_category,
                result_count, duration_ms, model_entry_id, asset_ids,
                started_at, completed_at
         FROM generation_task_records
         WHERE user_id = $1 ${cursorClause}
         ORDER BY completed_at DESC, id DESC
         LIMIT $${values.length}`,
        values,
      );
      const page = result.rows.slice(0, 50);
      return {
        items: page.map(recordSummary),
        nextCursor:
          result.rows.length > 50 && page.at(-1)
            ? encodeCursor(page.at(-1)!)
            : null,
      };
    },
  };
}
