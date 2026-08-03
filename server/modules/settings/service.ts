import type {
  CanvasPreferences,
  CanvasPreferencesResponse,
  UpdateCanvasPreferencesRequest,
} from "@ai-canvas-cloud/contracts";
import {
  canvasAutosaveIntervals,
  DEFAULT_CANVAS_PREFERENCES,
} from "@ai-canvas-cloud/contracts/canvas-preferences";
import type { DbPool } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from "../workspaces/authorization.js";

const PREFERENCE_KEYS = [
  "autosaveIntervalMs",
  "canvasTopBarCollapsed",
  "alignmentGuidesEnabled",
  "incomingEdgeAnimationEnabled",
  "themeMode",
  "canvasPerformanceMode",
  "canvasGridEnabled",
  "edgeStyle",
  "lowQualityPreviewEnabled",
] as const satisfies readonly (keyof CanvasPreferences)[];

interface CanvasPreferencesDocument {
  schemaVersion: 1;
  settings: CanvasPreferences;
  updatedAt: string;
}

interface CanvasPreferencesRow {
  canvas_preferences: unknown;
}

export interface SettingsActor {
  userId: string;
  workspaceId: string;
}

export interface CanvasPreferencesService {
  get: (actor: SettingsActor) => Promise<CanvasPreferencesResponse>;
  update: (
    patch: UpdateCanvasPreferencesRequest,
    actor: SettingsActor,
  ) => Promise<CanvasPreferencesResponse>;
}

function validationError(message: string): never {
  throw new AuthServiceError({
    statusCode: 400,
    apiCode: "VALIDATION_FAILED",
    message,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanvasPreferences(value: unknown): value is CanvasPreferences {
  if (!isRecord(value)) return false;
  return (
    PREFERENCE_KEYS.every((key) => key in value) &&
    Object.keys(value).length === PREFERENCE_KEYS.length &&
    canvasAutosaveIntervals.includes(
      value.autosaveIntervalMs as (typeof canvasAutosaveIntervals)[number],
    ) &&
    typeof value.canvasTopBarCollapsed === "boolean" &&
    typeof value.alignmentGuidesEnabled === "boolean" &&
    typeof value.incomingEdgeAnimationEnabled === "boolean" &&
    (value.themeMode === "dark" ||
      value.themeMode === "light" ||
      value.themeMode === "system") &&
    (value.canvasPerformanceMode === "quality" ||
      value.canvasPerformanceMode === "performance") &&
    typeof value.canvasGridEnabled === "boolean" &&
    (value.edgeStyle === "animated" ||
      value.edgeStyle === "solid" ||
      value.edgeStyle === "step" ||
      value.edgeStyle === "smoothstep") &&
    typeof value.lowQualityPreviewEnabled === "boolean"
  );
}

function parseDocument(value: unknown): CanvasPreferencesDocument | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (!isCanvasPreferences(value.settings)) return null;
  if (
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    settings: value.settings,
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}

export function validateCanvasPreferencesPatch(
  input: unknown,
): UpdateCanvasPreferencesRequest {
  if (!isRecord(input)) validationError("Settings patch must be an object");
  const keys = Object.keys(input);
  if (keys.length === 0) validationError("Settings patch cannot be empty");
  if (keys.some((key) => !PREFERENCE_KEYS.includes(key as never))) {
    validationError("Settings patch contains unsupported fields");
  }

  const merged = { ...DEFAULT_CANVAS_PREFERENCES, ...input };
  if (!isCanvasPreferences(merged)) {
    validationError("Settings patch contains invalid values");
  }
  return Object.fromEntries(keys.map((key) => [key, input[key]]));
}

function responseFromRow(row: CanvasPreferencesRow | undefined) {
  const document = parseDocument(row?.canvas_preferences);
  return document
    ? { settings: document.settings, updatedAt: document.updatedAt }
    : { settings: null, updatedAt: null };
}

export function createPostgresCanvasPreferencesService(
  pool: DbPool,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): CanvasPreferencesService {
  const authorizationService =
    options.authorizationService ?? createWorkspaceAuthorizationService(pool);

  return {
    async get(actor) {
      await authorizationService.requireWorkspaceAccess(actor);
      const result = await pool.query<CanvasPreferencesRow>(
        `SELECT ui_state_json -> 'canvasPreferences' AS canvas_preferences
         FROM workspace_user_state
         WHERE workspace_id = $1 AND user_id = $2
         LIMIT 1`,
        [actor.workspaceId, actor.userId],
      );
      return responseFromRow(result.rows[0]);
    },

    async update(input, actor) {
      const patch = validateCanvasPreferencesPatch(input);
      await authorizationService.requireWorkspaceAccess(actor);
      const updatedAt = new Date().toISOString();
      const result = await pool.query<CanvasPreferencesRow>(
        `INSERT INTO workspace_user_state (workspace_id, user_id, ui_state_json, updated_at)
         VALUES (
           $1,
           $2,
           jsonb_build_object(
             'canvasPreferences',
             jsonb_build_object(
               'schemaVersion', 1,
               'settings', $3::jsonb || $4::jsonb,
               'updatedAt', $5::text
             )
           ),
           now()
         )
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET ui_state_json = jsonb_set(
               workspace_user_state.ui_state_json,
               '{canvasPreferences}',
               jsonb_build_object(
                 'schemaVersion', 1,
                 'settings',
                   $3::jsonb
                   || COALESCE(
                     workspace_user_state.ui_state_json #> '{canvasPreferences,settings}',
                     '{}'::jsonb
                   )
                   || $4::jsonb,
                 'updatedAt', $5::text
               ),
               true
             ),
             updated_at = now()
         RETURNING ui_state_json -> 'canvasPreferences' AS canvas_preferences`,
        [
          actor.workspaceId,
          actor.userId,
          JSON.stringify(DEFAULT_CANVAS_PREFERENCES),
          JSON.stringify(patch),
          updatedAt,
        ],
      );
      return responseFromRow(result.rows[0]);
    },
  };
}

export function createUnavailableCanvasPreferencesService(): CanvasPreferencesService {
  const unavailable = async (): Promise<never> => {
    throw new AuthServiceError({
      statusCode: 503,
      apiCode: "SERVICE_UNAVAILABLE",
      message: "Settings service is unavailable",
      retryable: true,
    });
  };
  return { get: unavailable, update: unavailable };
}
