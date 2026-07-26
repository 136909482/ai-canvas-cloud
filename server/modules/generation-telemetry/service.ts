import {
  generationFailureCategories,
  generationTelemetryCategories,
  type GenerationFailureCategory,
  type GenerationTelemetryRequest,
  type GenerationTelemetryResponse,
} from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import type { ProjectActor } from "../projects/service.js";
import type { WorkspaceAuthorizationService } from "../workspaces/authorization.js";

const ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;
const MAX_RESULT_COUNT = 32;

export interface GenerationTelemetryService {
  record(
    input: GenerationTelemetryRequest,
    actor: ProjectActor,
  ): Promise<GenerationTelemetryResponse>;
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
    validationError("Generation telemetry must be an object");
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    validationError("Generation telemetry contains unsupported fields");
  }
}

function requireDuration(value: unknown) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > MAX_DURATION_MS
  ) {
    validationError("Generation telemetry duration is invalid");
  }
  return Number(value);
}

export function validateGenerationTelemetryRequest(
  value: unknown,
): GenerationTelemetryRequest {
  const input = requireRecord(value);
  const attemptId = input.attemptId;
  const category = input.category;
  const status = input.status;

  if (typeof attemptId !== "string" || !ATTEMPT_ID_PATTERN.test(attemptId)) {
    validationError("Generation telemetry attempt id is invalid");
  }
  if (
    typeof category !== "string" ||
    !generationTelemetryCategories.includes(
      category as (typeof generationTelemetryCategories)[number],
    )
  ) {
    validationError("Generation telemetry category is invalid");
  }

  const base = {
    attemptId: attemptId.toLowerCase(),
    category: category as GenerationTelemetryRequest["category"],
  };

  if (status === "started") {
    rejectUnknownKeys(input, new Set(["attemptId", "category", "status"]));
    return { ...base, status };
  }

  const durationMs = requireDuration(input.durationMs);
  if (status === "succeeded") {
    rejectUnknownKeys(
      input,
      new Set(["attemptId", "category", "status", "durationMs", "resultCount"]),
    );
    if (
      !Number.isSafeInteger(input.resultCount) ||
      Number(input.resultCount) < 1 ||
      Number(input.resultCount) > MAX_RESULT_COUNT
    ) {
      validationError("Generation telemetry result count is invalid");
    }
    return {
      ...base,
      status,
      durationMs,
      resultCount: Number(input.resultCount),
    };
  }

  if (status === "failed") {
    rejectUnknownKeys(
      input,
      new Set([
        "attemptId",
        "category",
        "status",
        "durationMs",
        "failureCategory",
      ]),
    );
    if (
      typeof input.failureCategory !== "string" ||
      !generationFailureCategories.includes(
        input.failureCategory as (typeof generationFailureCategories)[number],
      )
    ) {
      validationError("Generation telemetry failure category is invalid");
    }
    return {
      ...base,
      status,
      durationMs,
      failureCategory: input.failureCategory as GenerationFailureCategory,
    };
  }

  if (status === "canceled") {
    rejectUnknownKeys(
      input,
      new Set(["attemptId", "category", "status", "durationMs"]),
    );
    return { ...base, status, durationMs };
  }

  return validationError("Generation telemetry status is invalid");
}

export function createUnavailableGenerationTelemetryService(): GenerationTelemetryService {
  return {
    async record() {
      throw new AuthServiceError({
        statusCode: 503,
        apiCode: "SERVICE_UNAVAILABLE",
        message: "Generation telemetry service is not configured",
        retryable: true,
      });
    },
  };
}

export function createPostgresGenerationTelemetryService(
  pool: DbPool,
  options: { authorizationService: WorkspaceAuthorizationService },
): GenerationTelemetryService {
  return {
    async record(rawInput, actor) {
      const input = validateGenerationTelemetryRequest(rawInput);
      await options.authorizationService.requireWorkspaceAccess({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      });

      const isStarted = input.status === "started";
      const failureCategory =
        input.status === "failed" ? input.failureCategory : null;
      const resultCount = input.status === "succeeded" ? input.resultCount : 0;
      const durationMs = isStarted ? null : input.durationMs;

      await pool.query(
        `
          INSERT INTO generation_telemetry (
            workspace_id,
            user_id,
            client_attempt_id,
            category,
            status,
            failure_category,
            result_count,
            duration_ms,
            completed_at
          ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            CASE WHEN $5 = 'started' THEN NULL ELSE now() END
          )
          ON CONFLICT (workspace_id, user_id, client_attempt_id) DO UPDATE
          SET status = EXCLUDED.status,
              failure_category = EXCLUDED.failure_category,
              result_count = EXCLUDED.result_count,
              duration_ms = EXCLUDED.duration_ms,
              completed_at = EXCLUDED.completed_at,
              updated_at = now()
          WHERE generation_telemetry.status = 'started'
            AND generation_telemetry.category = EXCLUDED.category
            AND EXCLUDED.status <> 'started'
        `,
        [
          actor.workspaceId,
          actor.userId,
          input.attemptId,
          input.category,
          input.status,
          failureCategory,
          resultCount,
          durationMs,
        ],
      );

      return {
        accepted: true,
        attemptId: input.attemptId,
        status: input.status,
      };
    },
  };
}
