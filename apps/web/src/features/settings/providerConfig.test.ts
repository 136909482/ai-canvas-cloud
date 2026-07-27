import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeModelConfig } from "./providerConfig.ts";
import { normalizeConfig } from "@/store/settingsConfig.ts";

test("runtime resolution uses model entry identity and its owning provider", () => {
  const config = normalizeConfig({
    providerProfiles: [
      {
        id: "provider-a",
        name: "Provider A",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "async",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    providerApiKeys: { "provider-a": "key-a" },
    modelEntries: [
      {
        id: "entry-a",
        providerProfileId: "provider-a",
        modelId: "gpt-image",
        displayName: "Image",
        category: "image",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  const resolved = resolveRuntimeModelConfig(config, {
    modelEntryId: "entry-a",
    category: "image",
    requireCredentials: true,
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.runtimeConfig.modelId, "gpt-image");
    assert.equal(resolved.runtimeConfig.apiKey, "key-a");
    assert.equal(resolved.runtimeConfig.requestMode, "sync");
  }
});

test("same upstream model ids resolve to their selected provider route", () => {
  const config = normalizeConfig({
    providerProfiles: [
      {
        id: "provider-a",
        name: "Provider A",
        protocol: "openai-compatible",
        baseUrl: "https://a.example/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "provider-b",
        name: "Provider B",
        protocol: "openai-compatible",
        baseUrl: "https://b.example/v1",
        enabled: true,
        imageRequestMode: "async",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    providerApiKeys: { "provider-a": "key-a", "provider-b": "key-b" },
    modelEntries: [
      {
        id: "entry-a",
        providerProfileId: "provider-a",
        modelId: "gpt-4o",
        displayName: "GPT A",
        category: "chat",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "entry-b",
        providerProfileId: "provider-b",
        modelId: "gpt-4o",
        displayName: "GPT B",
        category: "chat",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });

  const routeA = resolveRuntimeModelConfig(config, {
    modelEntryId: "entry-a",
    category: "chat",
    requireCredentials: true,
  });
  const routeB = resolveRuntimeModelConfig(config, {
    modelEntryId: "entry-b",
    category: "chat",
    requireCredentials: true,
  });

  assert.equal(routeA.ok, true);
  assert.equal(routeB.ok, true);
  if (routeA.ok && routeB.ok) {
    assert.equal(routeA.runtimeConfig.modelId, routeB.runtimeConfig.modelId);
    assert.equal(routeA.runtimeConfig.apiUrl, "https://a.example/v1");
    assert.equal(routeA.runtimeConfig.apiKey, "key-a");
    assert.equal(routeB.runtimeConfig.apiUrl, "https://b.example/v1");
    assert.equal(routeB.runtimeConfig.apiKey, "key-b");
  }
});

test("unbound entries cannot execute", () => {
  const config = normalizeConfig({
    modelEntries: [
      {
        id: "entry-a",
        providerProfileId: null,
        modelId: "model",
        displayName: "Model",
        category: "chat",
        source: "manual",
        status: "unbound",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  const resolved = resolveRuntimeModelConfig(config, {
    modelEntryId: "entry-a",
    requireCredentials: true,
  });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.diagnostic.code, "modelUnbound");
});
