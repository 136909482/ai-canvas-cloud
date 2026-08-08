import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeModelConfig } from "@/types";
import {
  createProviderBindingFingerprint,
  getImageProviderAdapter,
  resolveTaskAdapterId,
} from "./imageProviderAdapters.ts";

function runtimeConfig(
  overrides: Partial<RuntimeModelConfig> = {},
): RuntimeModelConfig {
  return {
    id: "model-entry-1",
    providerProfileId: "provider-1",
    modelId: "gpt-image-1",
    displayName: "Image model",
    category: "image",
    source: "manual",
    status: "available",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    apiKey: "secret",
    baseUrl: "https://provider.example/v1",
    apiUrl: "https://provider.example/v1",
    provider: "openai",
    protocol: "openai-compatible",
    authMode: "bearer",
    imageRequestMode: "sync",
    requestMode: "sync",
    ...overrides,
  };
}

test("adapter registry resolves only controlled image execution modes", () => {
  const syncConfig = runtimeConfig();
  const pollingConfig = runtimeConfig({
    imageRequestMode: "async",
    requestMode: "async",
  });

  assert.equal(
    resolveTaskAdapterId(syncConfig, "image"),
    "openai-compatible-sync",
  );
  assert.equal(
    resolveTaskAdapterId(pollingConfig, "image"),
    "openai-compatible-task-polling",
  );
  assert.equal(
    getImageProviderAdapter("openai-compatible-sync").executionMode,
    "sync",
  );
  assert.equal(
    getImageProviderAdapter("openai-compatible-task-polling").executionMode,
    "polling",
  );
  assert.throws(() => getImageProviderAdapter("dashscope-video-polling"));
});

test("provider binding fingerprint changes with private routing configuration", () => {
  const original = runtimeConfig();
  const originalFingerprint = createProviderBindingFingerprint(
    original,
    10,
    "image",
  );

  assert.equal(
    originalFingerprint,
    createProviderBindingFingerprint({ ...original }, 10, "image"),
  );
  assert.notEqual(
    originalFingerprint,
    createProviderBindingFingerprint(
      { ...original, apiKey: "rotated-secret" },
      10,
      "image",
    ),
  );
  assert.notEqual(
    originalFingerprint,
    createProviderBindingFingerprint(
      { ...original, baseUrl: "https://provider-rotated.example/v1" },
      10,
      "image",
    ),
  );
  assert.notEqual(
    originalFingerprint,
    createProviderBindingFingerprint(
      { ...original, protocol: "dashscope" },
      10,
      "image",
    ),
  );
  assert.notEqual(
    originalFingerprint,
    createProviderBindingFingerprint(
      {
        ...original,
        customManifest: {
          id: "manifest-1",
          schemaVersion: 1,
          name: "Manifest",
          executionMode: "sync",
          capabilities: { generate: true, edit: false },
          submit: {
            generate: {
              path: "v1/images/generations",
              method: "POST",
              contentType: "json",
              body: { model: "$model", prompt: "$prompt" },
              result: { imageUrlPaths: ["data.0.url"], base64Paths: [] },
            },
          },
          createdAt: 1,
          updatedAt: 1,
        },
        protocol: "custom-http-image-v1",
      },
      10,
      "image",
    ),
  );
  assert.notEqual(
    originalFingerprint,
    createProviderBindingFingerprint(original, 11, "image"),
  );
});
