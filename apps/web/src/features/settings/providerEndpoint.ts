export interface ValidateProviderEndpointOptions {
  production?: boolean;
}

export type ProviderEndpointValidationCode =
  | "emptyApiUrl"
  | "invalidApiUrl"
  | "insecureApiUrl"
  | "apiUrlCredentials"
  | "apiUrlFragment";

export type ProviderEndpointValidationResult =
  | {
      ok: true;
      url: string;
    }
  | {
      ok: false;
      code: ProviderEndpointValidationCode;
      message: string;
    };

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;

  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet)) &&
    Number(octets[0]) === 127 &&
    octets.every((octet) => Number(octet) <= 255)
  );
}

function isPrivateIpv4(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = normalized.split(".");
  if (
    octets.length !== 4 ||
    !octets.every((octet) => /^\d{1,3}$/.test(octet))
  ) {
    return false;
  }

  const values = octets.map(Number);
  if (values.some((value) => value > 255)) return false;
  return (
    values[0] === 10 ||
    (values[0] === 172 && values[1] >= 16 && values[1] <= 31) ||
    (values[0] === 192 && values[1] === 168)
  );
}

function isUniqueLocalIpv6(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return /^f[cd][0-9a-f:]*$/i.test(normalized);
}

function isDevelopmentHttpAddressAllowed(hostname: string) {
  return (
    isLoopbackHostname(hostname) ||
    isPrivateIpv4(hostname) ||
    isUniqueLocalIpv6(hostname)
  );
}

function isProductionBrowser() {
  if (typeof window === "undefined") return true;
  return (
    window.location.protocol === "https:" &&
    !isLoopbackHostname(window.location.hostname)
  );
}

export function validateProviderEndpoint(
  input: string,
  options: ValidateProviderEndpointOptions = {},
): ProviderEndpointValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, code: "emptyApiUrl", message: "请先填写 API 请求地址" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      code: "invalidApiUrl",
      message: "API 请求地址必须是完整 URL",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      code: "invalidApiUrl",
      message: "API 请求地址只支持 HTTP 或 HTTPS",
    };
  }

  const production = options.production ?? isProductionBrowser();
  if (production && parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "insecureApiUrl",
      message: "生产环境的服务商 endpoint 必须使用 HTTPS",
    };
  }

  if (
    !production &&
    parsed.protocol === "http:" &&
    !isDevelopmentHttpAddressAllowed(parsed.hostname)
  ) {
    return {
      ok: false,
      code: "insecureApiUrl",
      message: "HTTP 仅允许本地或私有网络开发地址，其他服务商请使用 HTTPS",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: "apiUrlCredentials",
      message: "API 请求地址不能包含用户名或密码",
    };
  }

  if (parsed.hash) {
    return {
      ok: false,
      code: "apiUrlFragment",
      message: "API 请求地址不能包含 fragment",
    };
  }

  return {
    ok: true,
    url: parsed.toString().replace(/\/$/, ""),
  };
}

function buildModelsUrl(endpoint: string) {
  const parsed = new URL(endpoint);
  const path = parsed.pathname.replace(/\/+$/, "");

  if (path.endsWith("/models")) {
    return parsed.toString();
  }

  if (path.endsWith("/v1")) {
    parsed.pathname = `${path}/models`;
    return parsed.toString();
  }

  parsed.pathname = `${path}/v1/models`.replace(/^\/\//, "/");
  return parsed.toString();
}

export async function testProviderEndpointDirect(
  input: { apiUrl: string; apiKey: string },
  options: ValidateProviderEndpointOptions & {
    fetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const validation = validateProviderEndpoint(input.apiUrl, options);
  if (!validation.ok) throw new Error(validation.message);
  if (!input.apiKey.trim()) throw new Error("请先填写 API Key");

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000,
  );

  try {
    const response = await (options.fetch ?? fetch)(
      buildModelsUrl(validation.url),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey.trim()}`,
          Accept: "application/json",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("服务商拒绝了当前凭据，请检查 API Key");
      }
      throw new Error(`连接测试失败：HTTP ${response.status}`);
    }

    return { ok: true as const, checkedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("连接测试超时");
    }
    if (error instanceof TypeError) {
      throw new Error("浏览器无法直连该服务商，请确认 HTTPS、CORS 和网络配置");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
