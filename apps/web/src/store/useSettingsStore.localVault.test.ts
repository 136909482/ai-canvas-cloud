import assert from "node:assert/strict";
import test from "node:test";
import { useSettingsStore } from "./useSettingsStore.ts";

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
            baseUrl: "https://example.com/v1",
            enabled: true,
            imageRequestMode: "sync",
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
    assert.equal(useSettingsStore.getState().config.providerProfiles.length, 0);
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
    assert.deepEqual(config.providerProfiles, [
      {
        id: "provider-a",
        name: "Provider",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 10,
        lastDiscoveryAt: 10,
      },
    ]);
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
