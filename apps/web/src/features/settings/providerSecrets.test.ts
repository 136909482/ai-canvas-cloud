import assert from "node:assert/strict";
import test from "node:test";
import {
  redactWorkspaceConfigSecretsForCache,
  redactWorkspaceConfigSecretsForExport,
} from "./providerSecrets.ts";

test("workspace config has no provider fields to redact", () => {
  const config = {
    version: 1 as const,
    storage: {
      autosaveIntervalMs: 60_000,
      canvasTopBarCollapsed: false,
      alignmentGuidesEnabled: true,
      incomingEdgeAnimationEnabled: true,
      themeMode: "dark" as const,
      canvasPerformanceMode: "quality" as const,
      canvasGridEnabled: true,
      edgeStyle: "animated" as const,
      lowQualityPreviewEnabled: true,
    },
  };
  assert.deepEqual(redactWorkspaceConfigSecretsForCache(config), config);
  assert.deepEqual(redactWorkspaceConfigSecretsForExport(config), config);
});
