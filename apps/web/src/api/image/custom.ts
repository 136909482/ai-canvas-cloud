import { fetchPollingRequestWithRetry } from "../pollingRetry.ts";
import {
  buildApiError,
  convertReferenceImageToFile,
  getNetworkErrorMessage,
  parseJsonLikeResponse,
} from "./shared.ts";
import { resolveOpenAiRequestSize } from "./openai.ts";
import type { GenerateImageParams } from "./types.ts";
import type {
  CustomImagePollMapping,
  CustomImageProviderManifestV1,
  CustomImageRequestMapping,
  CustomImageResultMapping,
  CustomImageTemplateValue,
  GenerateTaskRemoteStatus,
  ProviderAuthMode,
} from "@/types";

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

type TemplateContext = {
  model: string;
  prompt: string;
  negativePrompt: string;
  params: {
    ratio: string;
    resolution: string;
    quality: string;
    size: string;
    width: number | null;
    height: number | null;
  };
  inputImages: { urls: string[] };
  editImage: { url: string | null };
  mask: { url: string | null };
  taskId: string | null;
};

function getByPath(value: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current) && /^\d+$/.test(segment)) {
        return current[Number(segment)];
      }
      if (typeof current === "object") {
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, value);
}

function getAllByPath(value: unknown, path: string): unknown[] {
  let current: unknown[] = [value];
  for (const segment of path.split(".").filter(Boolean)) {
    const next: unknown[] = [];
    for (const item of current) {
      if (item === null || item === undefined) continue;
      if (segment === "*") {
        if (Array.isArray(item)) next.push(...item);
        else if (typeof item === "object") {
          next.push(...Object.values(item as Record<string, unknown>));
        }
      } else if (Array.isArray(item) && /^\d+$/.test(segment)) {
        next.push(item[Number(segment)]);
      } else if (typeof item === "object") {
        next.push((item as Record<string, unknown>)[segment]);
      }
    }
    current = next;
  }
  return current.flatMap((item) => (Array.isArray(item) ? item : [item]));
}

function getTemplateValue(context: TemplateContext, value: string) {
  switch (value) {
    case "$model":
      return context.model;
    case "$prompt":
      return context.prompt;
    case "$negativePrompt":
      return context.negativePrompt;
    case "$inputImages.urls":
      return context.inputImages.urls.length
        ? context.inputImages.urls
        : undefined;
    case "$editImage.url":
      return context.editImage.url ?? undefined;
    case "$mask.url":
      return context.mask.url ?? undefined;
    case "$taskId":
      return context.taskId ?? undefined;
    default:
      return value.startsWith("$params.")
        ? context.params[
            value.slice("$params.".length) as keyof TemplateContext["params"]
          ]
        : value;
  }
}

function renderTemplate(
  value: CustomImageTemplateValue,
  context: TemplateContext,
): unknown {
  if (typeof value === "string" && value.startsWith("$")) {
    return getTemplateValue(context, value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => renderTemplate(item, context))
      .filter((item) => item !== undefined && item !== null);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, renderTemplate(item, context)] as const)
        .filter(
          ([, item]) =>
            item !== undefined &&
            item !== null &&
            (!Array.isArray(item) || item.length > 0),
        ),
    );
  }
  return value;
}

function createAuthHeaders(
  authMode: ProviderAuthMode,
  apiKey: string,
): Record<string, string> {
  if (authMode === "none") return {};
  if (!apiKey.trim()) throw new Error("自定义服务商缺少 API Key");
  switch (authMode) {
    case "x-api-key":
      return { "X-API-Key": apiKey };
    case "api-key":
      return { "Api-Key": apiKey };
    default:
      return { Authorization: `Bearer ${apiKey}` };
  }
}

function buildProviderUrl(baseUrl: string, path: string, taskId?: string) {
  const normalizedBase = new URL(
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  const resolvedPath = path
    .replace(/\{task_id\}/g, encodeURIComponent(taskId ?? ""))
    .replace(/\{taskId\}/g, encodeURIComponent(taskId ?? ""))
    .replace(/\$taskId/g, encodeURIComponent(taskId ?? ""));
  const result = new URL(resolvedPath, normalizedBase);
  const basePath = normalizedBase.pathname.endsWith("/")
    ? normalizedBase.pathname
    : `${normalizedBase.pathname}/`;
  if (
    result.origin !== normalizedBase.origin ||
    !result.pathname.startsWith(basePath)
  ) {
    throw new Error("自定义服务商请求路径不得跨 Origin");
  }
  return result;
}

function appendQuery(
  url: URL,
  query: Record<string, CustomImageTemplateValue> | undefined,
  context: TemplateContext,
) {
  for (const [key, value] of Object.entries(query ?? {})) {
    const rendered = renderTemplate(value, context);
    if (rendered === undefined || rendered === null || rendered === "")
      continue;
    url.searchParams.set(
      key,
      typeof rendered === "object"
        ? JSON.stringify(rendered)
        : String(rendered),
    );
  }
}

async function createTemplateContext(
  params: GenerateImageParams,
  taskId: string | null,
): Promise<TemplateContext> {
  const size = await resolveOpenAiRequestSize(params);
  const matched = size.match(/^(\d+)x(\d+)$/i);
  return {
    model: params.model,
    prompt: params.prompt,
    negativePrompt: params.negativePrompt ?? "",
    params: {
      ratio: params.ratio ?? "Auto",
      resolution: params.resolution ?? "1K",
      quality: params.quality ?? "auto",
      size,
      width: matched ? Number(matched[1]) : null,
      height: matched ? Number(matched[2]) : null,
    },
    inputImages: {
      urls: params.referenceImageUrls?.length
        ? params.referenceImageUrls
        : params.referenceImageUrl
          ? [params.referenceImageUrl]
          : [],
    },
    editImage: { url: params.editImageUrl ?? null },
    mask: { url: params.maskImageUrl ?? null },
    taskId,
  };
}

async function appendMappedFiles(
  formData: FormData,
  mapping: CustomImageRequestMapping,
  context: TemplateContext,
) {
  let fileIndex = 0;
  for (const fileMapping of mapping.files ?? []) {
    const urls =
      fileMapping.source === "referenceImages"
        ? context.inputImages.urls
        : fileMapping.source === "editImage"
          ? context.editImage.url
            ? [context.editImage.url]
            : []
          : context.mask.url
            ? [context.mask.url]
            : [];
    const selectedUrls = fileMapping.multiple ? urls : urls.slice(0, 1);
    for (const url of selectedUrls) {
      const file = await convertReferenceImageToFile(url, fileIndex);
      formData.append(fileMapping.field, file, file.name);
      fileIndex += 1;
    }
  }
}

async function createRequestBody(
  mapping: CustomImageRequestMapping,
  context: TemplateContext,
  headers: Record<string, string>,
) {
  const rendered = renderTemplate(mapping.body ?? {}, context);
  if (mapping.contentType === "json") {
    headers["Content-Type"] = "application/json";
    return JSON.stringify(rendered);
  }
  const formData = new FormData();
  if (rendered && typeof rendered === "object" && !Array.isArray(rendered)) {
    for (const [key, value] of Object.entries(rendered)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) formData.append(key, String(item));
      } else if (typeof value === "object") {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    }
  }
  await appendMappedFiles(formData, mapping, context);
  return formData;
}

async function readProviderJson(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("自定义服务商响应超过 32 MiB 上限");
  }
  const { payload, rawText } = await parseJsonLikeResponse(response);
  if (new TextEncoder().encode(rawText).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("自定义服务商响应超过 32 MiB 上限");
  }
  return payload;
}

async function fetchProviderJson(url: URL, init: RequestInit, context: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    throw new Error(getNetworkErrorMessage(error, context), { cause: error });
  }
  if (!response.ok) throw await buildApiError(response, context);
  return readProviderJson(response);
}

async function submitCustomRequest(
  params: GenerateImageParams,
  mapping: CustomImageRequestMapping,
) {
  const context = await createTemplateContext(params, null);
  const url = buildProviderUrl(params.apiUrl, mapping.path);
  appendQuery(url, mapping.query, context);
  const headers: Record<string, string> = createAuthHeaders(
    params.authMode ?? "bearer",
    params.apiKey,
  );
  const body = await createRequestBody(mapping, context, headers);
  return fetchProviderJson(
    url,
    { method: "POST", headers, body, signal: params.signal },
    "Custom image Provider",
  );
}

function isImageUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^https?:\/\//i.test(value) || value.startsWith("data:image/"))
  );
}

function extractImage(payload: unknown, result: CustomImageResultMapping) {
  for (const path of result.imageUrlPaths) {
    const match = getAllByPath(payload, path).find(isImageUrl);
    if (match) return match;
  }
  for (const path of result.base64Paths) {
    const match = getAllByPath(payload, path).find(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    );
    if (match) {
      return match.startsWith("data:image/")
        ? match
        : `data:image/png;base64,${match}`;
    }
  }
  throw new Error("自定义服务商响应中没有可识别的图片结果");
}

function getOperationMapping(
  manifest: CustomImageProviderManifestV1,
  params: GenerateImageParams,
) {
  const isEdit = params.operationType !== "text-to-image";
  if (!isEdit) return manifest.submit.generate;
  if (!manifest.capabilities.edit || !manifest.submit.edit) {
    throw new Error("当前自定义服务商不支持图生图或图片编辑");
  }
  return manifest.submit.edit;
}

export async function startCustomImageGeneration(params: GenerateImageParams) {
  const manifest = params.customManifest;
  if (!manifest) throw new Error("自定义服务商缺少 Manifest");
  const mapping = getOperationMapping(manifest, params);
  const payload = await submitCustomRequest(params, mapping);
  if (manifest.executionMode === "sync") {
    if (!mapping.result) throw new Error("同步 Manifest 缺少结果提取规则");
    return {
      type: "completed" as const,
      output: extractImage(payload, mapping.result),
    };
  }
  if (!mapping.taskIdPath) throw new Error("异步 Manifest 缺少 taskIdPath");
  const rawTaskId = getByPath(payload, mapping.taskIdPath);
  const remoteTaskId =
    typeof rawTaskId === "string" || typeof rawTaskId === "number"
      ? String(rawTaskId).trim()
      : "";
  if (!remoteTaskId) throw new Error("无法从自定义服务商响应中提取任务 ID");
  return { type: "remote" as const, remoteTaskId };
}

function abortableSleep(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function queryCustomTask(
  params: GenerateImageParams,
  poll: CustomImagePollMapping,
  taskId: string,
) {
  const context = await createTemplateContext(params, taskId);
  const url = buildProviderUrl(params.apiUrl, poll.path, taskId);
  appendQuery(url, poll.query, context);
  const headers: Record<string, string> = createAuthHeaders(
    params.authMode ?? "bearer",
    params.apiKey,
  );
  let body: string | undefined;
  if (poll.method === "POST") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(renderTemplate(poll.body ?? {}, context));
  }
  const response = await fetchPollingRequestWithRetry(() =>
    fetch(url, {
      method: poll.method,
      headers,
      body,
      signal: params.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    }),
  );
  if (!response.ok) throw await buildApiError(response, "Custom image task");
  return readProviderJson(response);
}

export async function waitForCustomImageGeneration(
  params: GenerateImageParams,
  taskId: string,
  onStatusChange?: (status: GenerateTaskRemoteStatus) => void,
) {
  const poll = params.customManifest?.poll;
  if (!poll) throw new Error("异步自定义服务商缺少轮询配置");
  const startedAt = Date.now();
  const successValues = new Set(
    poll.successValues.map((value) => value.trim().toUpperCase()),
  );
  const failureValues = new Set(
    poll.failureValues.map((value) => value.trim().toUpperCase()),
  );
  onStatusChange?.("IN_PROGRESS");
  while (Date.now() - startedAt < poll.timeoutSeconds * 1000) {
    const payload = await queryCustomTask(params, poll, taskId);
    const status = String(getByPath(payload, poll.statusPath) ?? "")
      .trim()
      .toUpperCase();
    if (failureValues.has(status)) {
      onStatusChange?.("FAILURE");
      const error = poll.errorPath ? getByPath(payload, poll.errorPath) : null;
      throw new Error(
        typeof error === "string" && error.trim()
          ? error.slice(0, 2000)
          : "自定义服务商异步任务失败",
      );
    }
    if (successValues.has(status)) {
      onStatusChange?.("SUCCESS");
      return extractImage(payload, poll.result);
    }
    await abortableSleep(poll.intervalSeconds * 1000, params.signal);
  }
  throw new Error(`自定义服务商异步任务超过 ${poll.timeoutSeconds} 秒未完成`);
}
