import type { ModelCategory, ModelEntry } from "../../types";

export const PROVIDER_MODELS_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
export const PROVIDER_MODELS_RESPONSE_PREVIEW_BYTES = 512;
export const PROVIDER_MODELS_MAX_COUNT = 2_000;
export const PROVIDER_MODELS_DISCOVERY_TIMEOUT_MS = 15_000;
export const PROVIDER_MODELS_DISCOVERY_COOLDOWN_MS = 3_000;

export type NormalizeModelsEndpointErrorCode =
  | "empty"
  | "invalidUrl"
  | "unsupportedProtocol"
  | "insecureHttp"
  | "httpAddressNotAllowed"
  | "urlCredentials";

export type NormalizeModelsEndpointResult =
  | {
      ok: true;
      endpoint: URL;
      baseUrl: string;
      ignoredQuery: boolean;
      ignoredFragment: boolean;
    }
  | {
      ok: false;
      error: NormalizeModelsEndpointErrorCode;
    };

export type ProviderModelsDiscoveryErrorCode =
  | NormalizeModelsEndpointErrorCode
  | "missingCredentials"
  | "cancelled"
  | "timeout"
  | "network"
  | "responseTooLarge"
  | "authentication"
  | "notFound"
  | "rateLimited"
  | "upstream"
  | "http"
  | "invalidResponse"
  | "cooldown";

export interface ProviderModelsDiscoveryError {
  code: ProviderModelsDiscoveryErrorCode;
  message: string;
  status?: number;
  responsePreview?: string;
}

export interface DiscoveredProviderModel {
  modelId: string;
  ownedBy?: string;
  suggestedCategory: ModelCategory;
  requiresCategoryConfirmation: boolean;
}

export interface ProviderModelImportSelection {
  modelId: string;
  category: ModelCategory;
  displayName?: string;
}

export interface ReconcileDiscoveredModelsInput {
  providerProfileId: string;
  existingEntries: readonly ModelEntry[];
  discoveredModelIds: readonly string[];
  selectedModels: readonly ProviderModelImportSelection[];
  discoveredAt: number;
  createId?: () => string;
}

export type ParseProviderModelsResponseResult =
  | {
      ok: true;
      models: DiscoveredProviderModel[];
      discardedCount: number;
      truncated: boolean;
    }
  | {
      ok: false;
      error: ProviderModelsDiscoveryError;
    };

export type FetchProviderModelsDirectResult =
  | {
      ok: true;
      endpoint: string;
      baseUrl: string;
      ignoredQuery: boolean;
      ignoredFragment: boolean;
      models: DiscoveredProviderModel[];
      discardedCount: number;
      truncated: boolean;
    }
  | {
      ok: false;
      error: ProviderModelsDiscoveryError;
    };

export interface NormalizeModelsEndpointOptions {
  production?: boolean;
}

export interface FetchProviderModelsDirectOptions extends NormalizeModelsEndpointOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ProviderModelsDiscoveryRequest {
  providerProfileId: string;
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface ProviderModelsDiscoveryControllerOptions {
  cooldownMs?: number;
  now?: () => number;
  fetchProviderModels?: (
    baseUrl: string,
    apiKey: string,
    signal?: AbortSignal,
  ) => Promise<FetchProviderModelsDirectResult>;
}

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
  const hostname = window.location.hostname;
  return window.location.protocol === "https:" && !isLoopbackHostname(hostname);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function createDiscoveryError(
  code: ProviderModelsDiscoveryErrorCode,
  overrides: Omit<ProviderModelsDiscoveryError, "code" | "message"> = {},
): ProviderModelsDiscoveryError {
  const messages: Record<ProviderModelsDiscoveryErrorCode, string> = {
    empty: "请先填写服务商地址",
    invalidUrl: "服务商地址必须是完整的 HTTP(S) URL",
    unsupportedProtocol: "服务商地址只支持 HTTP 或 HTTPS",
    insecureHttp: "生产环境的服务商地址必须使用 HTTPS",
    httpAddressNotAllowed:
      "开发环境的 HTTP 地址仅允许本机或私有网络地址，请改用 HTTPS",
    urlCredentials: "服务商地址不能包含用户名或密码",
    missingCredentials: "请先填写 API Key",
    cancelled: "已取消获取模型",
    timeout: "获取模型超时（15 秒）",
    network:
      "无法连接服务商。请检查 CORS、地址可达性、协议或证书；该服务商可能不支持浏览器直连，可改用手工添加。",
    responseTooLarge: "服务商返回的数据超过 2 MiB，已停止读取",
    authentication: "鉴权失败，请检查 API Key",
    notFound: "未找到 /v1/models，请检查 Base URL 是否需要包含 /v1",
    rateLimited: "服务商限流，请稍后重试",
    upstream: "服务商暂时不可用，请稍后重试",
    http: "获取模型失败，服务商返回了异常状态",
    invalidResponse: "服务商响应不符合 OpenAI 模型列表格式",
    cooldown: "请等待 3 秒后再获取模型",
  };

  return { code, message: messages[code], ...overrides };
}

function baseUrlFromEndpoint(endpoint: URL) {
  const baseUrl = new URL(endpoint);
  const path = baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.pathname = path.endsWith("/models")
    ? path.slice(0, -"/models".length) || "/"
    : path || "/";
  baseUrl.search = "";
  baseUrl.hash = "";
  return trimTrailingSlash(baseUrl.toString());
}

export function normalizeModelsEndpoint(
  input: string,
  options: NormalizeModelsEndpointOptions = {},
): NormalizeModelsEndpointResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "empty" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalidUrl" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "unsupportedProtocol" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "urlCredentials" };
  }

  const production = options.production ?? isProductionBrowser();
  if (production && parsed.protocol !== "https:") {
    return { ok: false, error: "insecureHttp" };
  }
  if (
    !production &&
    parsed.protocol === "http:" &&
    !isDevelopmentHttpAddressAllowed(parsed.hostname)
  ) {
    return { ok: false, error: "httpAddressNotAllowed" };
  }

  const ignoredQuery = Boolean(parsed.search);
  const ignoredFragment = Boolean(parsed.hash);
  parsed.search = "";
  parsed.hash = "";

  const path = parsed.pathname.replace(/\/+$/, "");
  if (path.endsWith("/models")) {
    parsed.pathname = path || "/models";
  } else if (path.endsWith("/v1")) {
    parsed.pathname = `${path}/models`;
  } else {
    parsed.pathname = `${path || ""}/v1/models`.replace(/^\/{2,}/, "/");
  }

  return {
    ok: true,
    endpoint: parsed,
    baseUrl: baseUrlFromEndpoint(parsed),
    ignoredQuery,
    ignoredFragment,
  };
}

export function suggestModelCategory(modelId: string): {
  category: ModelCategory;
  requiresConfirmation: boolean;
} {
  const normalized = modelId.toLowerCase();
  if (
    /(?:dall-e|flux|stable[-_ ]?diffusion|(?:^|[-_/])sd(?:[-_/]|$)|image)/.test(
      normalized,
    )
  ) {
    return { category: "image", requiresConfirmation: false };
  }
  if (/(?:sora|veo|video|kling)/.test(normalized)) {
    return { category: "video", requiresConfirmation: false };
  }

  if (
    /(?:gpt|chatgpt|claude|gemini|deepseek|qwen|glm|kimi|minimax|mistral|llama|mixtral|command-r|cohere|grok|moonshot|doubao|hunyuan|ernie|baichuan|codex|seed)/.test(
      normalized,
    )
  ) {
    return { category: "chat", requiresConfirmation: false };
  }

  return { category: "chat", requiresConfirmation: true };
}

function normalizeImportCategory(value: unknown): ModelCategory {
  return value === "image" || value === "video" ? value : "chat";
}

function createDiscoveredModelId() {
  return crypto.randomUUID();
}

/**
 * Reconcile only entries that were previously imported from this provider.
 * Manual entries intentionally remain untouched, including when their ID is
 * absent from the latest upstream response.
 */
export function reconcileDiscoveredModels(
  input: ReconcileDiscoveredModelsInput,
): ModelEntry[] {
  const providerProfileId = input.providerProfileId.trim();
  if (!providerProfileId) return [...input.existingEntries];

  const discoveredIds = new Set(
    input.discoveredModelIds.map((modelId) => modelId.trim()).filter(Boolean),
  );
  const existingIds = new Set(
    input.existingEntries
      .filter((entry) => entry.providerProfileId === providerProfileId)
      .map((entry) => entry.modelId),
  );
  const selectedByModelId = new Map<string, ProviderModelImportSelection>();
  for (const selection of input.selectedModels) {
    const modelId = selection.modelId.trim();
    if (!modelId || !discoveredIds.has(modelId) || existingIds.has(modelId)) {
      continue;
    }
    selectedByModelId.set(modelId, {
      modelId,
      category: normalizeImportCategory(selection.category),
      ...(selection.displayName?.trim()
        ? { displayName: selection.displayName.trim() }
        : {}),
    });
  }

  const reconciled = input.existingEntries.map((entry) => {
    if (
      entry.providerProfileId !== providerProfileId ||
      entry.source !== "discovered"
    ) {
      return entry;
    }

    if (discoveredIds.has(entry.modelId)) {
      return {
        ...entry,
        status: "available" as const,
        lastSeenAt: input.discoveredAt,
        updatedAt: input.discoveredAt,
      };
    }

    if (entry.status === "missing") return entry;
    return {
      ...entry,
      status: "missing" as const,
      updatedAt: input.discoveredAt,
    };
  });

  const createId = input.createId ?? createDiscoveredModelId;
  for (const selection of selectedByModelId.values()) {
    reconciled.push({
      id: createId(),
      providerProfileId,
      modelId: selection.modelId,
      displayName: selection.displayName ?? selection.modelId,
      category: selection.category,
      source: "discovered",
      status: "available",
      enabled: true,
      createdAt: input.discoveredAt,
      updatedAt: input.discoveredAt,
      lastSeenAt: input.discoveredAt,
    });
  }

  return reconciled;
}

function truncatePreview(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new TextDecoder().decode(
    bytes.slice(0, PROVIDER_MODELS_RESPONSE_PREVIEW_BYTES),
  );
}

export function redactProviderResponsePreview(value: string) {
  return truncatePreview(value)
    .replace(
      /\bauthorization\s*[:=]\s*["']?bearer\s+[^\s"'<>\\]+/gi,
      "Authorization: Bearer [已隐藏]",
    )
    .replace(/\bbearer\s+[^\s"'<>\\]+/gi, "Bearer [已隐藏]");
}

export function parseProviderModelsResponse(
  responseBody: string,
): ParseProviderModelsResponseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return {
      ok: false,
      error: createDiscoveryError("invalidResponse", {
        responsePreview: redactProviderResponsePreview(responseBody),
      }),
    };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { data?: unknown }).data)
  ) {
    return {
      ok: false,
      error: createDiscoveryError("invalidResponse", {
        responsePreview: redactProviderResponsePreview(responseBody),
      }),
    };
  }

  const models: DiscoveredProviderModel[] = [];
  const seenModelIds = new Set<string>();
  let discardedCount = 0;
  let truncated = false;

  for (const item of (parsed as { data: unknown[] }).data) {
    const itemRecord = item as { id?: unknown; owned_by?: unknown } | null;
    const modelId =
      itemRecord && typeof itemRecord.id === "string"
        ? itemRecord.id.trim()
        : "";
    if (!modelId || modelId.length > 256 || seenModelIds.has(modelId)) {
      discardedCount += 1;
      continue;
    }

    seenModelIds.add(modelId);
    if (models.length >= PROVIDER_MODELS_MAX_COUNT) {
      truncated = true;
      continue;
    }

    const suggestion = suggestModelCategory(modelId);
    models.push({
      modelId,
      ownedBy:
        itemRecord &&
        typeof itemRecord.owned_by === "string" &&
        itemRecord.owned_by.trim()
          ? itemRecord.owned_by.trim()
          : undefined,
      suggestedCategory: suggestion.category,
      requiresCategoryConfirmation: suggestion.requiresConfirmation,
    });
  }

  return { ok: true, models, discardedCount, truncated };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name?: unknown }).name === "AbortError";
}

export function classifyProviderModelsHttpError(status: number) {
  if (status === 401 || status === 403) {
    return createDiscoveryError("authentication", { status });
  }
  if (status === 404) return createDiscoveryError("notFound", { status });
  if (status === 429) return createDiscoveryError("rateLimited", { status });
  if (status >= 500 && status <= 599) {
    return createDiscoveryError("upstream", { status });
  }
  return createDiscoveryError("http", { status });
}

async function readResponseBody(
  response: Response,
  controller: AbortController,
  maxResponseBytes: number,
) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        controller.abort();
        await reader.cancel();
        throw createDiscoveryError("responseTooLarge");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function addAbortListener(
  signal: AbortSignal | undefined,
  controller: AbortController,
) {
  if (!signal) return () => undefined;
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export async function fetchProviderModelsDirect(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
  options: FetchProviderModelsDirectOptions = {},
): Promise<FetchProviderModelsDirectResult> {
  const normalized = normalizeModelsEndpoint(baseUrl, options);
  if (!normalized.ok) {
    return { ok: false, error: createDiscoveryError(normalized.error) };
  }

  const credential = apiKey.trim();
  if (!credential) {
    return { ok: false, error: createDiscoveryError("missingCredentials") };
  }

  const controller = new AbortController();
  const removeAbortListener = addAbortListener(signal, controller);
  let didTimeout = false;
  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, options.timeoutMs ?? PROVIDER_MODELS_DISCOVERY_TIMEOUT_MS);

  try {
    const response = await (options.fetch ?? globalThis.fetch)(
      normalized.endpoint,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credential}`,
          Accept: "application/json",
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        mode: "cors",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        error: classifyProviderModelsHttpError(response.status),
      };
    }

    const body = await readResponseBody(
      response,
      controller,
      options.maxResponseBytes ?? PROVIDER_MODELS_RESPONSE_LIMIT_BYTES,
    );
    const parsed = parseProviderModelsResponse(body);
    if (!parsed.ok) return parsed;

    return {
      endpoint: normalized.endpoint.toString(),
      baseUrl: normalized.baseUrl,
      ignoredQuery: normalized.ignoredQuery,
      ignoredFragment: normalized.ignoredFragment,
      ...parsed,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "responseTooLarge"
    ) {
      return { ok: false, error: error as ProviderModelsDiscoveryError };
    }
    if (didTimeout) {
      return { ok: false, error: createDiscoveryError("timeout") };
    }
    if (signal?.aborted || isAbortError(error)) {
      return { ok: false, error: createDiscoveryError("cancelled") };
    }
    if (error instanceof TypeError) {
      return { ok: false, error: createDiscoveryError("network") };
    }
    return { ok: false, error: createDiscoveryError("network") };
  } finally {
    globalThis.clearTimeout(timeoutId);
    removeAbortListener();
  }
}

export class ProviderModelsDiscoveryController {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly fetchProviderModels: NonNullable<
    ProviderModelsDiscoveryControllerOptions["fetchProviderModels"]
  >;
  private readonly inFlight = new Map<
    string,
    Promise<FetchProviderModelsDirectResult>
  >();
  private readonly lastStartedAt = new Map<string, number>();

  constructor(options: ProviderModelsDiscoveryControllerOptions = {}) {
    this.cooldownMs =
      options.cooldownMs ?? PROVIDER_MODELS_DISCOVERY_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
    this.fetchProviderModels =
      options.fetchProviderModels ?? fetchProviderModelsDirect;
  }

  discover(
    request: ProviderModelsDiscoveryRequest,
  ): Promise<FetchProviderModelsDirectResult> {
    const requestKey = request.providerProfileId.trim();
    const inFlight = this.inFlight.get(requestKey);
    if (inFlight) return inFlight;

    const startedAt = this.lastStartedAt.get(requestKey);
    if (startedAt !== undefined && this.now() - startedAt < this.cooldownMs) {
      return Promise.resolve({
        ok: false,
        error: createDiscoveryError("cooldown"),
      });
    }

    this.lastStartedAt.set(requestKey, this.now());
    const operation = this.fetchProviderModels(
      request.baseUrl,
      request.apiKey,
      request.signal,
    ).finally(() => {
      if (this.inFlight.get(requestKey) === operation) {
        this.inFlight.delete(requestKey);
      }
    });
    this.inFlight.set(requestKey, operation);
    return operation;
  }
}
