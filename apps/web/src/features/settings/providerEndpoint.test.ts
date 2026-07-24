import {
  testProviderEndpointDirect,
  validateProviderEndpoint,
} from "./providerEndpoint.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runProviderEndpointTests() {
  assert(
    !validateProviderEndpoint("http://provider.example/v1", {
      production: true,
    }).ok,
    "production should reject HTTP",
  );
  assert(
    !validateProviderEndpoint("https://user:pass@provider.example/v1", {
      production: true,
    }).ok,
    "URL credentials should be rejected",
  );
  assert(
    !validateProviderEndpoint("https://provider.example/v1#secret", {
      production: true,
    }).ok,
    "fragments should be rejected",
  );
  assert(
    validateProviderEndpoint("http://127.0.0.1:9000/v1", { production: false })
      .ok,
    "local development should allow loopback HTTP",
  );
  assert(
    validateProviderEndpoint("http://192.168.1.20:9000/v1", {
      production: false,
    }).ok,
    "local development should allow private-network HTTP",
  );
  assert(
    !validateProviderEndpoint("http://provider.example/v1", {
      production: false,
    }).ok,
    "development should not allow remote cleartext HTTP",
  );

  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const result = await testProviderEndpointDirect(
    {
      apiUrl: "https://provider.example/v1",
      apiKey: "test-secret",
    },
    {
      production: true,
      fetch: async (url, init) => {
        requestedUrl = String(url);
        requestedInit = init;
        return new Response("{}", { status: 200 });
      },
    },
  );

  assert(result.ok, "a successful direct response should pass");
  assert(
    requestedUrl === "https://provider.example/v1/models",
    "connection tests should target the provider directly",
  );
  assert(
    requestedInit?.credentials === "omit",
    "connection tests must not attach Cloud cookies",
  );
  assert(
    requestedInit?.redirect === "error",
    "connection tests must not forward credentials across redirects",
  );
  assert(
    requestedInit?.referrerPolicy === "no-referrer",
    "connection tests should not disclose the Cloud page URL",
  );
}

await runProviderEndpointTests();
