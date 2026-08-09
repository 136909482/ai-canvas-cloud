import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_MODELS_MAX_COUNT,
  ProviderModelsDiscoveryController,
  classifyProviderModelsHttpError,
  fetchProviderModelsDirect,
  normalizeModelsEndpoint,
  parseProviderModelsResponse,
  redactProviderResponsePreview,
  reconcileDiscoveredModels,
  suggestModelCategory,
} from "./providerModelDiscovery.ts";

test("normalizes the supported OpenAI-compatible model endpoints", () => {
  const origin = normalizeModelsEndpoint("https://api.example.com", {
    production: true,
  });
  assert.equal(origin.ok, true);
  if (origin.ok) {
    assert.equal(
      origin.endpoint.toString(),
      "https://api.example.com/v1/models",
    );
    assert.equal(origin.baseUrl, "https://api.example.com/v1");
  }

  const versionBase = normalizeModelsEndpoint("https://api.example.com/v1", {
    production: true,
  });
  assert.equal(versionBase.ok, true);
  if (versionBase.ok) {
    assert.equal(
      versionBase.endpoint.toString(),
      "https://api.example.com/v1/models",
    );
    assert.equal(versionBase.baseUrl, "https://api.example.com/v1");
  }

  const versioned = normalizeModelsEndpoint(
    "https://api.example.com/v1/models/?source=draft#fragment",
    { production: true },
  );
  assert.equal(versioned.ok, true);
  if (versioned.ok) {
    assert.equal(
      versioned.endpoint.toString(),
      "https://api.example.com/v1/models",
    );
    assert.equal(versioned.baseUrl, "https://api.example.com/v1");
    assert.equal(versioned.ignoredQuery, true);
    assert.equal(versioned.ignoredFragment, true);
  }

  const gatewayRoot = normalizeModelsEndpoint(
    "https://gateway.example/tenant-a",
    { production: true },
  );
  const gatewayVersioned = normalizeModelsEndpoint(
    "https://gateway.example/tenant-a/v1",
    { production: true },
  );
  assert.equal(gatewayRoot.ok, true);
  assert.equal(gatewayVersioned.ok, true);
  if (gatewayRoot.ok && gatewayVersioned.ok) {
    assert.equal(
      gatewayRoot.endpoint.toString(),
      "https://gateway.example/tenant-a/v1/models",
    );
    assert.equal(
      gatewayRoot.endpoint.toString(),
      gatewayVersioned.endpoint.toString(),
    );
    assert.equal(gatewayRoot.baseUrl, gatewayVersioned.baseUrl);
  }
});

test("only allows safe HTTP addresses during local development", () => {
  for (const hostname of [
    "127.0.0.1",
    "10.20.30.40",
    "172.16.0.1",
    "192.168.1.1",
    "[fd12::42]",
  ]) {
    assert.equal(
      normalizeModelsEndpoint(`http://${hostname}:8080/v1`, {
        production: false,
      }).ok,
      true,
      `${hostname} should be permitted during development`,
    );
  }

  assert.equal(
    normalizeModelsEndpoint("http://provider.example/v1", {
      production: false,
    }).ok,
    false,
  );
  assert.deepEqual(
    normalizeModelsEndpoint("http://provider.example/v1", {
      production: true,
    }),
    { ok: false, error: "insecureHttp" },
  );
  assert.deepEqual(
    normalizeModelsEndpoint("https://user:pass@provider.example/v1", {
      production: true,
    }),
    { ok: false, error: "urlCredentials" },
  );
});

test("parses model IDs defensively and keeps exact-case identities", () => {
  const tooLongId = "x".repeat(257);
  const parsed = parseProviderModelsResponse(
    JSON.stringify({
      data: [
        { id: "gpt-4o", owned_by: "openai" },
        { id: "GPT-4O" },
        { id: "  flux-pro  " },
        { id: " " },
        { id: tooLongId },
        { id: "gpt-4o" },
        { id: 42 },
      ],
      ignored: true,
    }),
  );

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(
      parsed.models.map((model) => model.modelId),
      ["gpt-4o", "GPT-4O", "flux-pro"],
    );
    assert.equal(parsed.models[2].suggestedCategory, "image");
    assert.equal(parsed.discardedCount, 4);
  }
});

test("caps discovered models and leaves unknown categories for confirmation", () => {
  const parsed = parseProviderModelsResponse(
    JSON.stringify({
      data: Array.from(
        { length: PROVIDER_MODELS_MAX_COUNT + 1 },
        (_, index) => ({
          id: `model-${index}`,
        }),
      ),
    }),
  );

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.models.length, PROVIDER_MODELS_MAX_COUNT);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.models[0].requiresCategoryConfirmation, true);
  }
  assert.deepEqual(suggestModelCategory("veo-3"), {
    category: "video",
    requiresConfirmation: false,
  });
  assert.deepEqual(suggestModelCategory("gpt-image-2-all"), {
    category: "image",
    requiresConfirmation: false,
  });
  for (const modelId of [
    "nano-banana-pro",
    "nano_banana_pro",
    "nano banana pro",
    "models/nano-banana-pro-preview",
  ]) {
    assert.deepEqual(suggestModelCategory(modelId), {
      category: "image",
      requiresConfirmation: false,
    });
  }
  assert.deepEqual(suggestModelCategory("gpt-5.5"), {
    category: "chat",
    requiresConfirmation: false,
  });
});

test("invalid responses expose a short redacted preview without credentials", () => {
  const preview = redactProviderResponsePreview(
    "Authorization: Bearer response-secret-token " + "x".repeat(600),
  );
  assert.equal(preview.includes("response-secret-token"), false);
  assert.equal(preview.includes("Bearer [已隐藏]"), true);
  assert.equal(new TextEncoder().encode(preview).byteLength <= 512, true);

  const parsed = parseProviderModelsResponse(
    "<html>Authorization: Bearer response-secret-token</html>",
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "invalidResponse");
    assert.equal(
      parsed.error.responsePreview?.includes("response-secret-token"),
      false,
    );
  }
});

test("classifies observable HTTP failures without retaining request details", () => {
  assert.equal(classifyProviderModelsHttpError(401).code, "authentication");
  assert.equal(classifyProviderModelsHttpError(404).code, "notFound");
  assert.equal(classifyProviderModelsHttpError(429).code, "rateLimited");
  assert.equal(classifyProviderModelsHttpError(503).code, "upstream");
  assert.equal(classifyProviderModelsHttpError(418).code, "http");
});

test("direct discovery uses only the controlled browser request shape", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const result = await fetchProviderModelsDirect(
    "https://provider.example/v1",
    "test-key",
    undefined,
    {
      production: true,
      fetch: async (url, init) => {
        requestedUrl = String(url);
        requestedInit = init;
        return new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }));
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(requestedUrl, "https://provider.example/v1/models");
  assert.equal(requestedInit?.credentials, "omit");
  assert.equal(requestedInit?.redirect, "error");
  assert.equal(requestedInit?.referrerPolicy, "no-referrer");
  assert.equal(requestedInit?.cache, "no-store");
  assert.equal(requestedInit?.mode, "cors");
  assert.deepEqual(requestedInit?.headers, {
    Authorization: "Bearer test-key",
    Accept: "application/json",
  });
});

test("direct discovery accepts a base URL with or without the v1 suffix", async () => {
  const requestedUrls: string[] = [];

  for (const baseUrl of [
    "https://provider.example",
    "https://provider.example/v1",
  ]) {
    const result = await fetchProviderModelsDirect(
      baseUrl,
      "test-key",
      undefined,
      {
        production: true,
        fetch: async (url) => {
          requestedUrls.push(String(url));
          return new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }));
        },
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.baseUrl, "https://provider.example/v1");
    }
  }

  assert.deepEqual(requestedUrls, [
    "https://provider.example/v1/models",
    "https://provider.example/v1/models",
  ]);
});

test("stops reading oversized model-list responses", async () => {
  const result = await fetchProviderModelsDirect(
    "https://provider.example/v1",
    "test-key",
    undefined,
    {
      production: true,
      maxResponseBytes: 16,
      fetch: async () =>
        new Response(JSON.stringify({ data: [{ id: "too-long" }] })),
    },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "responseTooLarge");
});

test("controller de-duplicates in-flight requests and enforces a cooldown", async () => {
  let now = 1_000;
  let calls = 0;
  let resolveRequest:
    | ((value: Awaited<ReturnType<typeof fetchProviderModelsDirect>>) => void)
    | undefined;
  const controller = new ProviderModelsDiscoveryController({
    now: () => now,
    fetchProviderModels: async () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  });
  const request = {
    providerProfileId: "provider-a",
    baseUrl: "https://provider.example/v1",
    apiKey: "test-key",
  };

  const first = controller.discover(request);
  const duplicate = controller.discover(request);
  assert.equal(first, duplicate);
  assert.equal(calls, 1);

  resolveRequest?.({
    ok: true,
    endpoint: "https://provider.example/v1/models",
    baseUrl: "https://provider.example/v1",
    ignoredQuery: false,
    ignoredFragment: false,
    models: [],
    discardedCount: 0,
    truncated: false,
  });
  await first;

  now += 2_999;
  const cooldown = await controller.discover(request);
  assert.equal(cooldown.ok, false);
  if (!cooldown.ok) assert.equal(cooldown.error.code, "cooldown");

  now += 1;
  const next = controller.discover(request);
  assert.equal(calls, 2);
  resolveRequest?.({
    ok: true,
    endpoint: "https://provider.example/v1/models",
    baseUrl: "https://provider.example/v1",
    ignoredQuery: false,
    ignoredFragment: false,
    models: [],
    discardedCount: 0,
    truncated: false,
  });
  await next;
});

test("reconciliation marks absent discovered entries missing without touching manual models", () => {
  const entries = reconcileDiscoveredModels({
    providerProfileId: "provider-a",
    existingEntries: [
      {
        id: "manual-entry",
        providerProfileId: "provider-a",
        modelId: "manual-model",
        displayName: "Manual name",
        category: "video",
        source: "manual",
        status: "available",
        enabled: false,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: "known-entry",
        providerProfileId: "provider-a",
        modelId: "known-model",
        displayName: "Renamed model",
        category: "image",
        source: "discovered",
        status: "available",
        enabled: false,
        createdAt: 3,
        updatedAt: 4,
      },
      {
        id: "removed-entry",
        providerProfileId: "provider-a",
        modelId: "removed-model",
        displayName: "Removed model",
        category: "chat",
        source: "discovered",
        status: "available",
        enabled: true,
        createdAt: 5,
        updatedAt: 6,
      },
    ],
    discoveredModelIds: ["known-model", "new-model"],
    selectedModels: [{ modelId: "new-model", category: "video" }],
    discoveredAt: 100,
    createId: () => "new-entry",
  });

  assert.deepEqual(entries[0], {
    id: "manual-entry",
    providerProfileId: "provider-a",
    modelId: "manual-model",
    displayName: "Manual name",
    category: "video",
    source: "manual",
    status: "available",
    enabled: false,
    createdAt: 1,
    updatedAt: 2,
  });
  assert.deepEqual(entries[1], {
    id: "known-entry",
    providerProfileId: "provider-a",
    modelId: "known-model",
    displayName: "Renamed model",
    category: "image",
    source: "discovered",
    status: "available",
    enabled: false,
    createdAt: 3,
    updatedAt: 100,
    lastSeenAt: 100,
  });
  assert.equal(entries[2].status, "missing");
  assert.deepEqual(entries[3], {
    id: "new-entry",
    providerProfileId: "provider-a",
    modelId: "new-model",
    displayName: "new-model",
    category: "video",
    source: "discovered",
    status: "available",
    enabled: true,
    createdAt: 100,
    updatedAt: 100,
    lastSeenAt: 100,
  });
});

test("reconciliation restores a missing discovered model while retaining user edits", () => {
  const [entry] = reconcileDiscoveredModels({
    providerProfileId: "provider-a",
    existingEntries: [
      {
        id: "entry-a",
        providerProfileId: "provider-a",
        modelId: "gpt-4o",
        displayName: "My GPT",
        category: "image",
        source: "discovered",
        status: "missing",
        enabled: false,
        createdAt: 1,
        updatedAt: 2,
        lastSeenAt: 2,
      },
    ],
    discoveredModelIds: ["gpt-4o"],
    selectedModels: [],
    discoveredAt: 10,
  });

  assert.equal(entry.status, "available");
  assert.equal(entry.displayName, "My GPT");
  assert.equal(entry.category, "image");
  assert.equal(entry.enabled, false);
  assert.equal(entry.lastSeenAt, 10);
});
