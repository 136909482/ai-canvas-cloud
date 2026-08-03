import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CANVAS_PREFERENCES } from "@ai-canvas-cloud/contracts/canvas-preferences";
import { AuthServiceError } from "../auth/service.ts";
import {
  createPostgresCanvasPreferencesService,
  validateCanvasPreferencesPatch,
} from "./service.ts";

test("settings validation rejects unsupported and sensitive fields", () => {
  assert.throws(
    () => validateCanvasPreferencesPatch({ apiKey: "secret" }),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.apiCode === "VALIDATION_FAILED",
  );
  assert.throws(() => validateCanvasPreferencesPatch({}), AuthServiceError);
});

test("settings service authorizes the trusted actor and preserves other UI state", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const actor = { userId: "user_1", workspaceId: "workspace_1" };
  const service = createPostgresCanvasPreferencesService(
    {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        return {
          rows: [
            {
              canvas_preferences: {
                schemaVersion: 1,
                settings: {
                  ...DEFAULT_CANVAS_PREFERENCES,
                  canvasPerformanceMode: "performance",
                },
                updatedAt: "2026-08-03T12:00:00.000Z",
              },
            },
          ],
        };
      },
    } as never,
    {
      authorizationService: {
        async requireWorkspaceAccess(input) {
          assert.deepEqual(input, actor);
          return {} as never;
        },
      },
    },
  );

  const response = await service.update(
    { canvasPerformanceMode: "performance" },
    actor,
  );
  assert.equal(response.settings?.canvasPerformanceMode, "performance");
  assert.match(calls[0]!.text, /jsonb_set/);
  assert.match(calls[0]!.text, /workspace_user_state\.ui_state_json/);
  assert.deepEqual(calls[0]!.values?.slice(0, 2), ["workspace_1", "user_1"]);
});

test("settings service returns an uninitialized response when no document exists", async () => {
  const service = createPostgresCanvasPreferencesService(
    {
      async query() {
        return { rows: [] };
      },
    } as never,
    {
      authorizationService: {
        async requireWorkspaceAccess() {
          return {} as never;
        },
      },
    },
  );
  assert.deepEqual(
    await service.get({ userId: "user_1", workspaceId: "workspace_1" }),
    { settings: null, updatedAt: null },
  );
});
