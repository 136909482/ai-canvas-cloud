import assert from "node:assert/strict";
import test from "node:test";
import { useSettingsStore } from "./useSettingsStore.ts";
import { createDefaultCustomImageProviderManifest } from "../features/settings/customImageProviderManifest.ts";

test("deleting a provider cascades to its model entries", () => {
  const originalConfig = structuredClone(useSettingsStore.getState().config);
  try {
    useSettingsStore.setState({
      config: {
        ...originalConfig,
        providerProfiles: [
          {
            id: "provider-a",
            name: "Provider",
            protocol: "openai-compatible",
            authMode: "bearer",
            baseUrl: "https://example.com/v1",
            enabled: true,
            imageRequestMode: "sync",
            imageResponseFormat: "url",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        providerApiKeys: { "provider-a": "key" },
        localModelBindings: {
          "local:11111111-1111-4111-8111-111111111111": "entry-a",
        },
        modelEntries: [
          {
            id: "entry-a",
            providerProfileId: "provider-a",
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
      },
    });
    useSettingsStore.getState().deleteProviderProfile("provider-a");
    assert.deepEqual(
      useSettingsStore
        .getState()
        .config.providerProfiles.map((profile) => profile.id),
      ["builtin-provider-deepseek"],
    );
    assert.equal(useSettingsStore.getState().config.modelEntries.length, 0);
    assert.equal(
      useSettingsStore
        .getState()
        .resolveLocalModelReference(
          "local:11111111-1111-4111-8111-111111111111",
        ),
      "entry-a",
    );
  } finally {
    useSettingsStore.setState({ config: originalConfig });
  }
});

test("built-in providers cannot be deleted", () => {
  const originalConfig = structuredClone(useSettingsStore.getState().config);
  try {
    useSettingsStore.setState({ config: originalConfig });
    useSettingsStore
      .getState()
      .deleteProviderProfile("builtin-provider-deepseek");
    assert.equal(
      useSettingsStore
        .getState()
        .config.providerProfiles.some(
          (profile) => profile.id === "builtin-provider-deepseek",
        ),
      true,
    );
  } finally {
    useSettingsStore.setState({ config: originalConfig });
  }
});

test("saving an existing provider keeps its creation-time protocol", () => {
  const originalConfig = structuredClone(useSettingsStore.getState().config);
  try {
    useSettingsStore.setState({
      config: {
        ...originalConfig,
        providerProfiles: [
          {
            id: "provider-a",
            name: "OpenAI",
            protocol: "openai-compatible",
            authMode: "bearer",
            baseUrl: "https://example.com/v1",
            enabled: true,
            imageRequestMode: "sync",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        providerApiKeys: { "provider-a": "key" },
      },
    });

    useSettingsStore.getState().saveProviderProfile({
      id: "provider-a",
      name: "OpenAI renamed",
      protocol: "custom-http-image-v1",
      authMode: "x-api-key",
      customManifestId: "manifest-id",
      baseUrl: "https://custom.example.com",
      enabled: true,
      imageRequestMode: "async",
      createdAt: 1,
      updatedAt: 2,
    });

    const [profile] = useSettingsStore.getState().config.providerProfiles;
    assert.equal(profile?.protocol, "openai-compatible");
    assert.equal(profile?.authMode, "bearer");
    assert.equal(profile?.imageRequestMode, "sync");
    assert.equal(profile?.customManifestId, undefined);
    assert.equal(profile?.baseUrl, "https://custom.example.com");
  } finally {
    useSettingsStore.setState({ config: originalConfig });
  }
});

test("discovery import stores a provider, credential slot, and selected models together", async () => {
  const originalConfig = structuredClone(useSettingsStore.getState().config);
  try {
    useSettingsStore.setState({
      config: {
        ...originalConfig,
        providerProfiles: [],
        providerApiKeys: {},
        modelEntries: [],
      },
    });

    await useSettingsStore.getState().saveProviderDiscoveryImport({
      profile: {
        id: "provider-a",
        name: "Provider",
        protocol: "openai-compatible",
        authMode: "bearer",
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 1,
      },
      apiKey: "test-key",
      discoveredModelIds: ["gpt-4o", "veo-3"],
      selectedModels: [{ modelId: "veo-3", category: "video" }],
      discoveredAt: 10,
    });

    const { config } = useSettingsStore.getState();
    assert.deepEqual(
      config.providerProfiles.find((profile) => profile.id === "provider-a"),
      {
        id: "provider-a",
        name: "Provider",
        protocol: "openai-compatible",
        authMode: "bearer",
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "sync",
        imageResponseFormat: "url",
        createdAt: 1,
        updatedAt: 10,
        lastDiscoveryAt: 10,
      },
    );
    assert.equal(
      config.providerProfiles.some(
        (profile) => profile.id === "builtin-provider-deepseek",
      ),
      true,
    );
    assert.equal(config.providerApiKeys["provider-a"], "test-key");
    const [model] = config.modelEntries;
    assert.equal(typeof model?.id, "string");
    assert.deepEqual(
      { ...model, id: "generated-id" },
      {
        id: "generated-id",
        providerProfileId: "provider-a",
        modelId: "veo-3",
        displayName: "veo-3",
        category: "video",
        source: "discovered",
        status: "available",
        enabled: true,
        createdAt: 10,
        updatedAt: 10,
        lastSeenAt: 10,
      },
    );
  } finally {
    useSettingsStore.setState({ config: originalConfig });
  }
});

test("custom provider discovery keeps its manifest and execution mode", async () => {
  const originalConfig = structuredClone(useSettingsStore.getState().config);
  try {
    const manifest = createDefaultCustomImageProviderManifest("polling");
    useSettingsStore.setState({
      config: {
        ...originalConfig,
        providerProfiles: [],
        customImageProviderManifests: [manifest],
        providerApiKeys: {},
        modelEntries: [],
      },
    });

    await useSettingsStore.getState().saveProviderDiscoveryImport({
      profile: {
        id: "custom-provider-a",
        name: "Custom Image",
        protocol: "custom-http-image-v1",
        authMode: "x-api-key",
        customManifestId: manifest.id,
        baseUrl: "https://provider.example/v1",
        enabled: true,
        imageRequestMode: "async",
        createdAt: 1,
        updatedAt: 1,
      },
      apiKey: "test-key",
      discoveredModelIds: ["nano-banana"],
      selectedModels: [{ modelId: "nano-banana", category: "image" }],
      discoveredAt: 10,
    });

    const { config } = useSettingsStore.getState();
    const customProfile = config.providerProfiles.find(
      (profile) => profile.id === "custom-provider-a",
    );
    assert.equal(customProfile?.customManifestId, manifest.id);
    assert.equal(customProfile?.authMode, "x-api-key");
    assert.equal(customProfile?.imageRequestMode, "async");
    assert.equal(config.modelEntries[0]?.category, "image");
  } finally {
    useSettingsStore.setState({ config: originalConfig });
  }
});
