import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConfig, toWorkspaceConfigFile } from "./settingsConfig.ts";

test("v2 settings config keeps provider keys and model identity local", () => {
  const config = normalizeConfig({
    defaultModelEntryId: "model-entry",
    providerProfiles: [
      {
        id: "provider-entry",
        name: "Provider",
        protocol: "openai-compatible",
        authMode: "bearer",
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    providerApiKeys: { "provider-entry": " secret " },
    modelEntries: [
      {
        id: "model-entry",
        providerProfileId: "provider-entry",
        modelId: "model-a",
        displayName: "Model A",
        category: "image",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });

  assert.equal(config.providerApiKeys["provider-entry"], "secret");
  assert.equal(config.defaultModelEntryId, "model-entry");
  assert.equal(toWorkspaceConfigFile(config).version, 1);
  assert.deepEqual(Object.keys(toWorkspaceConfigFile(config)), [
    "version",
    "storage",
  ]);
});

test("standard providers normalize to bearer and synchronous image requests", () => {
  const config = normalizeConfig({
    providerProfiles: [
      {
        id: "openai-provider",
        name: "OpenAI legacy",
        protocol: "openai-compatible",
        authMode: "x-api-key",
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "async",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "dashscope-provider",
        name: "DashScope legacy",
        protocol: "dashscope",
        authMode: "none",
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
        enabled: true,
        imageRequestMode: "async",
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: "custom-provider",
        name: "Custom",
        protocol: "custom-http-image-v1",
        authMode: "x-api-key",
        baseUrl: "https://custom.example.com",
        enabled: true,
        imageRequestMode: "async",
        createdAt: 3,
        updatedAt: 3,
      },
    ],
    providerApiKeys: {
      "openai-provider": "openai-key",
      "dashscope-provider": "dashscope-key",
      "custom-provider": "custom-key",
    },
  });

  const openai = config.providerProfiles.find(
    (profile) => profile.id === "openai-provider",
  );
  const dashscope = config.providerProfiles.find(
    (profile) => profile.id === "dashscope-provider",
  );
  const custom = config.providerProfiles.find(
    (profile) => profile.id === "custom-provider",
  );

  assert.equal(openai?.authMode, "bearer");
  assert.equal(openai?.imageRequestMode, "sync");
  assert.equal(dashscope?.authMode, "bearer");
  assert.equal(dashscope?.imageRequestMode, "sync");
  assert.equal(custom?.authMode, "x-api-key");
  assert.equal(custom?.imageRequestMode, "sync");
  assert.deepEqual(config.providerApiKeys, {
    "openai-provider": "openai-key",
    "dashscope-provider": "dashscope-key",
    "custom-provider": "custom-key",
  });
});

test("deleted model bindings remain available for node-level recovery UI", () => {
  const config = normalizeConfig({
    localModelBindings: {
      "local:11111111-1111-4111-8111-111111111111": "deleted-entry",
    },
  });

  assert.deepEqual(config.localModelBindings, {
    "local:11111111-1111-4111-8111-111111111111": "deleted-entry",
  });
});

test("last used model ids are normalized by category", () => {
  const config = normalizeConfig({
    defaultModelEntryId: "image-entry",
    lastUsedModelEntryIds: {
      chat: "chat-entry",
      image: "image-entry",
      video: "chat-entry",
    },
    providerProfiles: [
      {
        id: "provider-entry",
        name: "Provider",
        protocol: "openai-compatible",
        authMode: "bearer",
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    modelEntries: [
      {
        id: "chat-entry",
        providerProfileId: "provider-entry",
        modelId: "chat-model",
        displayName: "Chat Model",
        category: "chat",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "image-entry",
        providerProfileId: "provider-entry",
        modelId: "image-model",
        displayName: "Image Model",
        category: "image",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });

  assert.deepEqual(config.lastUsedModelEntryIds, {
    chat: "chat-entry",
    image: "image-entry",
  });
});

test("incoming edge animation defaults on and persists with workspace settings", () => {
  const defaultConfig = normalizeConfig();
  assert.equal(defaultConfig.storage.incomingEdgeAnimationEnabled, true);

  const disabledConfig = normalizeConfig({
    storage: { incomingEdgeAnimationEnabled: false },
  });
  assert.equal(disabledConfig.storage.incomingEdgeAnimationEnabled, false);
  assert.equal(
    toWorkspaceConfigFile(disabledConfig).storage.incomingEdgeAnimationEnabled,
    false,
  );
});
