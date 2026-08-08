import type { ImageOperationType } from "@/types";
import {
  SUPPORTED_GENERATE_RATIOS,
  type SupportedGenerateRatio,
} from "@/constants/generateNode";
import { fetchPollingRequestWithRetry } from "../pollingRetry.ts";
import {
  buildApiError,
  convertReferenceImageToFile,
  getFirstStringValue,
  getImageResultFromResponsePayload,
  getImageResultFromUnknown,
  getNestedValue,
  getNetworkErrorMessage,
  normalizeApiUrl,
  normalizeReferenceImages,
  parseJsonLikeResponse,
  resolveEffectiveRatio,
  resolvePromptRatio,
  resolveReferenceImageRatio,
  resolveImageOperationType,
  sleep,
} from "./shared.ts";
import type {
  AsyncImageTaskQueryResult,
  AsyncImageTaskStatus,
  AsyncImageTaskSubmission,
  GenerateImageParams,
} from "./types.ts";

const ASYNC_IMAGE_TASK_STATUS_ALIASES: Record<string, AsyncImageTaskStatus> = {
  IN_PROGRESS: "IN_PROGRESS",
  PROCESSING: "IN_PROGRESS",
  PENDING: "IN_PROGRESS",
  PENDING_QUEUE: "IN_PROGRESS",
  QUEUED: "IN_PROGRESS",
  RUNNING: "IN_PROGRESS",
  SUBMITTED: "IN_PROGRESS",
  WAITING: "IN_PROGRESS",
  SUCCESS: "SUCCESS",
  SUCCEEDED: "SUCCESS",
  COMPLETED: "SUCCESS",
  DONE: "SUCCESS",
  FINISHED: "SUCCESS",
  FAILURE: "FAILURE",
  FAILED: "FAILURE",
  ERROR: "FAILURE",
  CANCELLED: "FAILURE",
  CANCELED: "FAILURE",
};

const NUMBERED_REFERENCE_PROMPT_PATTERN =
  /(?:first image|second image|third image|fourth image|fifth image|image\s*[1-9]|reference image\s*[1-9])/i;
const ENABLE_OPENAI_NUMBERED_REFERENCE_HINTS = false;

type GptImageResolution = "1k" | "2k" | "4k";

const GPT_IMAGE_2_PIXEL_SIZES: Record<
  SupportedGenerateRatio,
  Record<GptImageResolution, string>
> = {
  "1:1": { "1k": "1024x1024", "2k": "2048x2048", "4k": "2880x2880" },
  "3:2": { "1k": "1536x1024", "2k": "2048x1360", "4k": "3520x2336" },
  "2:3": { "1k": "1024x1536", "2k": "1360x2048", "4k": "2336x3520" },
  "4:3": { "1k": "1024x768", "2k": "2048x1536", "4k": "3312x2480" },
  "3:4": { "1k": "768x1024", "2k": "1536x2048", "4k": "2480x3312" },
  "5:4": { "1k": "1280x1024", "2k": "2560x2048", "4k": "3216x2576" },
  "4:5": { "1k": "1024x1280", "2k": "2048x2560", "4k": "2576x3216" },
  "16:9": { "1k": "1536x864", "2k": "2048x1152", "4k": "3840x2160" },
  "9:16": { "1k": "864x1536", "2k": "1152x2048", "4k": "2160x3840" },
  "2:1": { "1k": "1774x887", "2k": "2688x1344", "4k": "3840x1920" },
  "1:2": { "1k": "887x1774", "2k": "1344x2688", "4k": "1920x3840" },
  "3:1": { "1k": "1536x512", "2k": "3072x1024", "4k": "3840x1280" },
  "1:3": { "1k": "512x1536", "2k": "1024x3072", "4k": "1280x3840" },
  "21:9": { "1k": "2016x864", "2k": "2688x1152", "4k": "3840x1648" },
  "9:21": { "1k": "864x2016", "2k": "1152x2688", "4k": "1648x3840" },
};

const OPENAI_ENDPOINT_PATHS = [
  "/v1/images/generations",
  "/v1/images/edits",
  "/v1/models",
  "/v1/images/tasks",
  "/v1/tasks",
] as const;

const OPENAI_ASYNC_POLL_INTERVAL_MS = 3500;
const OPENAI_ASYNC_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const GPT_IMAGE_2_INITIAL_POLL_DELAY_MS = 10 * 1000;

type OpenAiCompatibleImageRequestFamily = "openai" | "gemini" | "generic";

function getOrdinalLabel(order: number) {
  switch (order) {
    case 1:
      return "first";
    case 2:
      return "second";
    case 3:
      return "third";
    case 4:
      return "fourth";
    case 5:
      return "fifth";
    default:
      return `${order}th`;
  }
}

function shouldInjectNumberedReferencePrompt(
  model: string,
  prompt: string,
  referenceImageCount: number,
) {
  return (
    ENABLE_OPENAI_NUMBERED_REFERENCE_HINTS &&
    isGptImageModel(model) &&
    referenceImageCount > 1 &&
    NUMBERED_REFERENCE_PROMPT_PATTERN.test(prompt)
  );
}

function buildOpenAiReferenceAwarePrompt(
  model: string,
  prompt: string,
  referenceImageCount: number,
) {
  if (
    !shouldInjectNumberedReferencePrompt(model, prompt, referenceImageCount)
  ) {
    return prompt;
  }

  const numberedMappings = Array.from(
    { length: referenceImageCount },
    (_, index) =>
      `The ${getOrdinalLabel(index + 1)} uploaded image is image ${index + 1}.`,
  );

  return [
    "You will receive multiple reference images. Interpret them strictly by upload order.",
    ...numberedMappings,
    "If the user mentions a numbered reference image, follow that mapping exactly.",
    `User request: ${prompt}`,
  ].join("\n");
}

export function isGptImageModel(model: string) {
  return /(?:^|[-_/])gpt[-_]?image(?:[-_/]|$)/.test(model.trim().toLowerCase());
}

function isGeminiImageModel(model: string) {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.includes("gemini") ||
    normalized.includes("nano-banana") ||
    normalized.includes("nanobanana")
  );
}

function getOpenAiCompatibleImageRequestFamily(
  model: string,
): OpenAiCompatibleImageRequestFamily {
  if (isGptImageModel(model)) {
    return "openai";
  }

  if (isGeminiImageModel(model)) {
    return "gemini";
  }

  return "generic";
}

function normalizeGptImage2Resolution(resolution?: string): GptImageResolution {
  const normalized = resolution?.trim().toLowerCase();

  switch (normalized) {
    case "2k":
    case "4k":
    case "1k":
      return normalized;
    case "auto":
    default:
      return "1k";
  }
}

function normalizeGptImage2Quality(quality?: string | null) {
  switch (quality) {
    case "low":
    case "medium":
    case "high":
    case "auto":
      return quality;
    default:
      return "auto";
  }
}

function normalizeGeminiImageResolution(resolution?: string) {
  const normalized = resolution?.trim().toLowerCase();

  switch (normalized) {
    case "0.5k":
      return "0.5K";
    case "2k":
      return "2K";
    case "4k":
      return "4K";
    case "1k":
    default:
      return "1K";
  }
}

function getGreatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b > 0) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a || 1;
}

function normalizeSizePair(width: number, height: number) {
  const divisor = getGreatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function getGptImage2Size(ratio?: string, resolution?: string) {
  const normalizedRatio = ratio?.trim();
  const supportedRatio = SUPPORTED_GENERATE_RATIOS.includes(
    normalizedRatio as SupportedGenerateRatio,
  )
    ? (normalizedRatio as SupportedGenerateRatio)
    : "1:1";

  return GPT_IMAGE_2_PIXEL_SIZES[supportedRatio][
    normalizeGptImage2Resolution(resolution)
  ];
}

function hasOpenAiReferenceImage(params: GenerateImageParams) {
  return Boolean(
    params.editImageUrl ||
    normalizeReferenceImages(
      params.referenceImageUrl,
      params.referenceImageUrls,
    ).length > 0,
  );
}

async function resolveGptImage2RequestSize(params: GenerateImageParams) {
  if (
    SUPPORTED_GENERATE_RATIOS.includes(params.ratio as SupportedGenerateRatio)
  ) {
    return getGptImage2Size(params.ratio, params.resolution);
  }

  if (!hasOpenAiReferenceImage(params)) {
    const promptRatio = resolvePromptRatio(params.prompt);
    return promptRatio
      ? getGptImage2Size(promptRatio, params.resolution)
      : "auto";
  }

  const promptRatio = resolvePromptRatio(params.prompt);
  if (promptRatio) return getGptImage2Size(promptRatio, params.resolution);

  const referenceRatio = await resolveReferenceImageRatio(params);
  return referenceRatio
    ? getGptImage2Size(referenceRatio, params.resolution)
    : "auto";
}

function hasGeminiAutoRatioReference(params: GenerateImageParams) {
  if (resolveImageOperationType(params) === "image-edit") {
    return Boolean(
      params.editImageUrl ||
      normalizeReferenceImages(
        params.referenceImageUrl,
        params.referenceImageUrls,
      ).length > 0,
    );
  }

  return (
    normalizeReferenceImages(
      params.referenceImageUrl,
      params.referenceImageUrls,
    ).length > 0
  );
}

function resolveGeminiImageRequestSize(
  params: GenerateImageParams,
  effectiveRatio: string,
) {
  const ratio =
    !params.ratio || params.ratio === "Auto"
      ? hasGeminiAutoRatioReference(params)
        ? effectiveRatio
        : "auto"
      : params.ratio;

  if (!ratio || ratio.trim().toLowerCase() === "auto") {
    return "auto";
  }

  const normalizedRatio = ratio.trim().toLowerCase();
  if (/^\d+\s*x\s*\d+$/i.test(normalizedRatio)) {
    const matched = normalizedRatio.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (matched) {
      return normalizeSizePair(Number(matched[1]), Number(matched[2]));
    }
  }

  return normalizedRatio;
}

export async function resolveOpenAiRequestSize(params: GenerateImageParams) {
  const requestFamily = getOpenAiCompatibleImageRequestFamily(params.model);

  if (requestFamily === "openai") {
    return resolveGptImage2RequestSize(params);
  }

  const effectiveRatio = await resolveEffectiveRatio(params);
  return requestFamily === "gemini"
    ? resolveGeminiImageRequestSize(params, effectiveRatio)
    : getGptImage2Size(effectiveRatio, params.resolution);
}

export function resolveOpenAiEndpoint(
  apiUrl: string,
  endpointPath: (typeof OPENAI_ENDPOINT_PATHS)[number],
) {
  const normalized = normalizeApiUrl(apiUrl);

  if (normalized.endsWith(endpointPath)) {
    return normalized;
  }

  const matchedKnownEndpoint = OPENAI_ENDPOINT_PATHS.find((knownPath) =>
    normalized.endsWith(knownPath),
  );

  if (matchedKnownEndpoint) {
    return `${normalized.slice(0, -matchedKnownEndpoint.length)}${endpointPath}`;
  }

  if (normalized.endsWith("/v1")) {
    return `${normalized}${endpointPath.slice(3)}`;
  }

  return `${normalized}${endpointPath}`;
}

function getOpenAiProviderRequestUrl(endpoint: string) {
  return endpoint;
}

function getOpenAiRequestUrl(
  apiUrl: string,
  endpointPath: (typeof OPENAI_ENDPOINT_PATHS)[number],
) {
  return getOpenAiProviderRequestUrl(
    resolveOpenAiEndpoint(apiUrl, endpointPath),
  );
}

export function buildOpenAiTaskQueryUrl(apiUrl: string, taskId: string) {
  return `${resolveOpenAiEndpoint(apiUrl, "/v1/tasks")}/${encodeURIComponent(taskId)}`;
}

function getOpenAiImageEditInputImages(params: GenerateImageParams) {
  const operationType = resolveImageOperationType(params);
  return operationType === "image-edit"
    ? [
        ...(params.editImageUrl ? [params.editImageUrl] : []),
        ...normalizeReferenceImages(
          params.referenceImageUrl,
          params.referenceImageUrls,
        ),
      ]
    : normalizeReferenceImages(
        params.referenceImageUrl,
        params.referenceImageUrls,
      );
}

function shouldUseOpenAiImageEditRequest(params: GenerateImageParams) {
  return getOpenAiImageEditInputImages(params).length > 0;
}

function appendStringFormField(
  formData: FormData,
  key: string,
  value: string | number | boolean | null | undefined,
) {
  if (value === null || value === undefined) {
    return;
  }

  formData.append(key, String(value));
}

function buildGeminiImageConfig(imageSize: string, size: string) {
  return {
    image_size: imageSize,
    resolution: imageSize,
    aspect_ratio: size,
  };
}

function addGeminiImagePayloadFields(
  payload: Record<string, unknown>,
  params: GenerateImageParams,
  size: string,
) {
  const imageSize = normalizeGeminiImageResolution(params.resolution);
  const imageConfig = buildGeminiImageConfig(imageSize, size);

  payload.resolution = imageSize;
  payload.image_size = imageSize;
  payload.image_config = imageConfig;
  payload.aspect_ratio = size;
}

function addGeminiImageFormFields(
  formData: FormData,
  params: GenerateImageParams,
  size: string,
) {
  const imageSize = normalizeGeminiImageResolution(params.resolution);
  const imageConfig = buildGeminiImageConfig(imageSize, size);

  appendStringFormField(formData, "resolution", imageSize);
  appendStringFormField(formData, "image_size", imageSize);
  appendStringFormField(formData, "image_config", JSON.stringify(imageConfig));
  appendStringFormField(formData, "aspect_ratio", size);
}

async function buildGptImageGenerationPayload(
  params: GenerateImageParams,
  size: string,
) {
  const requestFamily = getOpenAiCompatibleImageRequestFamily(params.model);
  const payload: Record<string, unknown> = {
    model: params.model,
    prompt: buildOpenAiReferenceAwarePrompt(params.model, params.prompt, 0),
    n: 1,
    size,
  };

  if (requestFamily === "openai") {
    Object.assign(payload, {
      quality: normalizeGptImage2Quality(params.quality),
      moderation: "auto",
      output_format: "png",
    });
  }

  if (requestFamily === "gemini") {
    addGeminiImagePayloadFields(payload, params, size);
  }

  return payload;
}

async function buildGptImageEditFormData(
  params: GenerateImageParams,
  size: string,
) {
  const requestFamily = getOpenAiCompatibleImageRequestFamily(params.model);
  const operationType = resolveImageOperationType(params);
  const inputImages = getOpenAiImageEditInputImages(params);

  if (operationType === "image-edit" && !params.editImageUrl) {
    throw new Error("OpenAI image edit requires a source image");
  }

  if (operationType === "image-edit" && !params.maskImageUrl) {
    throw new Error("OpenAI image edit requires a mask image");
  }

  const imageFiles = await Promise.all(
    inputImages.map((imageUrl, index) =>
      convertReferenceImageToFile(imageUrl, index),
    ),
  );
  const formData = new FormData();
  const imageFieldName =
    requestFamily === "openai" || imageFiles.length > 1 ? "image[]" : "image";

  appendStringFormField(formData, "model", params.model);
  appendStringFormField(
    formData,
    "prompt",
    buildOpenAiReferenceAwarePrompt(
      params.model,
      params.prompt,
      imageFiles.length,
    ),
  );
  appendStringFormField(formData, "n", 1);
  appendStringFormField(formData, "size", size);

  if (requestFamily === "openai") {
    appendStringFormField(
      formData,
      "quality",
      normalizeGptImage2Quality(params.quality),
    );
    appendStringFormField(formData, "moderation", "auto");
    appendStringFormField(formData, "output_format", "png");
  }

  if (requestFamily === "gemini") {
    addGeminiImageFormFields(formData, params, size);
  }

  for (const imageFile of imageFiles) {
    formData.append(imageFieldName, imageFile);
  }

  if (operationType === "image-edit" && params.maskImageUrl) {
    formData.append(
      "mask",
      await convertReferenceImageToFile(params.maskImageUrl, imageFiles.length),
    );
  }

  return formData;
}

async function buildGptImageRequestBody(
  params: GenerateImageParams,
  size: string,
) {
  if (shouldUseOpenAiImageEditRequest(params)) {
    return buildGptImageEditFormData(params, size);
  }

  return JSON.stringify(await buildGptImageGenerationPayload(params, size));
}

function resolveOpenAiImageEndpointPath(
  params: GenerateImageParams,
  operationType: ImageOperationType,
) {
  return operationType === "image-edit" ||
    shouldUseOpenAiImageEditRequest(params)
    ? "/v1/images/edits"
    : "/v1/images/generations";
}

function getAsyncTaskId(payload: unknown) {
  const taskId = getFirstStringValue(
    getNestedValue(payload, ["task_id"]),
    getNestedValue(payload, ["data", "task_id"]),
    getNestedValue(payload, ["data", 0, "task_id"]),
    getNestedValue(payload, ["data", "data", "task_id"]),
  );

  if (!taskId) {
    throw new Error("Async image API did not return a task_id");
  }

  return taskId;
}

function getAsyncTaskStatus(
  payload: unknown,
  rawText?: string,
): AsyncImageTaskStatus {
  const status = getFirstStringValue(
    getNestedValue(payload, ["status"]),
    getNestedValue(payload, ["data", "status"]),
    getNestedValue(payload, ["data", 0, "status"]),
    getNestedValue(payload, ["data", "data", "status"]),
  );

  if (status) {
    const normalizedStatus =
      ASYNC_IMAGE_TASK_STATUS_ALIASES[status.trim().toUpperCase()];

    if (normalizedStatus) {
      return normalizedStatus;
    }
  }

  if (getImageResultFromUnknown(payload)) {
    return "SUCCESS";
  }

  const failReason = getFirstStringValue(
    getNestedValue(payload, ["fail_reason"]),
    getNestedValue(payload, ["data", "fail_reason"]),
    getNestedValue(payload, ["data", "error"]),
    getNestedValue(payload, ["data", "data", "fail_reason"]),
  );

  if (failReason) {
    return "FAILURE";
  }

  const responseCode = getFirstStringValue(
    getNestedValue(payload, ["code"]),
    getNestedValue(payload, ["data", "code"]),
    getNestedValue(payload, ["data", "data", "code"]),
  );

  if (responseCode && responseCode.trim().toLowerCase() === "success") {
    return "IN_PROGRESS";
  }

  const preview = rawText?.trim().slice(0, 240);
  throw new Error(
    preview
      ? `Async image API returned an unknown task status: ${preview}`
      : "Async image API returned an unknown task status",
  );
}

function getAsyncTaskErrorMessage(payload: unknown) {
  return (
    getFirstStringValue(
      getNestedValue(payload, ["fail_reason"]),
      getNestedValue(payload, ["data", "fail_reason"]),
      getNestedValue(payload, ["data", "error"]),
      getNestedValue(payload, ["data", "data", "fail_reason"]),
      getNestedValue(payload, ["error", "message"]),
      getNestedValue(payload, ["message"]),
      getNestedValue(payload, ["msg"]),
      getNestedValue(payload, ["data", "message"]),
      getNestedValue(payload, ["data", "msg"]),
      getNestedValue(payload, ["data", "data", "message"]),
      getNestedValue(payload, ["data", "data", "msg"]),
    ) ?? "Async image task failed"
  );
}

export async function generateWithOpenAI(
  params: GenerateImageParams,
): Promise<string> {
  const operationType = resolveImageOperationType(params);
  const endpointPath = resolveOpenAiImageEndpointPath(params, operationType);
  const generationsEndpoint = getOpenAiRequestUrl(params.apiUrl, endpointPath);
  const size = await resolveOpenAiRequestSize(params);

  if (params.requestMode === "async") {
    const submission = await submitOpenAiAsyncImageGeneration(params, size);
    return waitForOpenAiAsyncImageGeneration(params, submission.taskId);
  }

  const requestBody = shouldUseOpenAiImageEditRequest(params)
    ? await buildGptImageEditFormData(params, size)
    : await buildGptImageRequestBody(params, size);
  const requestHeaders = new Headers({
    Authorization: `Bearer ${params.apiKey}`,
  });
  if (typeof requestBody === "string") {
    requestHeaders.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(generationsEndpoint, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
    });
  } catch (error) {
    throw new Error(
      getNetworkErrorMessage(error, "OpenAI compatible image generation"),
    );
  }

  if (!response.ok) {
    throw await buildApiError(response, "OpenAI compatible image generation");
  }

  const { payload, rawText } = await parseJsonLikeResponse(response);
  return getImageResultFromResponsePayload(payload, rawText);
}

export async function submitOpenAiAsyncImageGeneration(
  params: GenerateImageParams,
  resolvedSize?: string,
): Promise<AsyncImageTaskSubmission> {
  const operationType = resolveImageOperationType(params);

  const endpointPath = resolveOpenAiImageEndpointPath(params, operationType);
  const endpoint = resolveOpenAiEndpoint(params.apiUrl, endpointPath);
  const size = resolvedSize ?? (await resolveOpenAiRequestSize(params));
  const isMultipartEdit = shouldUseOpenAiImageEditRequest(params);
  const requestBody = isMultipartEdit
    ? await buildGptImageEditFormData(params, size)
    : JSON.stringify(await buildGptImageGenerationPayload(params, size));
  const requestHeaders = new Headers({
    Authorization: `Bearer ${params.apiKey}`,
  });
  if (typeof requestBody === "string") {
    requestHeaders.set("Content-Type", "application/json");
  }
  const asyncEndpoint = getOpenAiProviderRequestUrl(endpoint);

  let response: Response;

  try {
    response = await fetch(asyncEndpoint, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
    });
  } catch (error) {
    throw new Error(
      getNetworkErrorMessage(error, "OpenAI compatible async image submission"),
    );
  }

  if (!response.ok) {
    throw await buildApiError(
      response,
      "OpenAI compatible async image submission",
    );
  }

  const { payload } = await parseJsonLikeResponse(response);
  return {
    taskId: getAsyncTaskId(payload),
  };
}

async function queryOpenAiAsyncImageGeneration(
  params: GenerateImageParams,
  taskId: string,
): Promise<AsyncImageTaskQueryResult> {
  const taskEndpoint = buildOpenAiTaskQueryUrl(params.apiUrl, taskId);
  let response: Response;

  try {
    response = await fetchPollingRequestWithRetry(() =>
      fetch(taskEndpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
        },
      }),
    );
  } catch (error) {
    throw new Error(
      getNetworkErrorMessage(error, "OpenAI compatible async image query"),
    );
  }

  if (!response.ok) {
    throw await buildApiError(response, "OpenAI compatible async image query");
  }

  const { payload, rawText } = await parseJsonLikeResponse(response);
  const status = getAsyncTaskStatus(payload, rawText);

  if (status === "SUCCESS") {
    const imageUrl = getImageResultFromResponsePayload(payload, rawText);
    return {
      status,
      imageUrl,
    };
  }

  if (status === "FAILURE") {
    return {
      status,
      errorMsg: getAsyncTaskErrorMessage(payload),
    };
  }

  return { status };
}

export async function waitForOpenAiAsyncImageGeneration(
  params: GenerateImageParams,
  taskId: string,
  onStatusChange?: (status: AsyncImageTaskStatus) => void,
): Promise<string> {
  const startedAt = Date.now();
  let hasWaitedInitialDelay = false;

  while (Date.now() - startedAt < OPENAI_ASYNC_POLL_TIMEOUT_MS) {
    if (!hasWaitedInitialDelay) {
      hasWaitedInitialDelay = true;
      await sleep(GPT_IMAGE_2_INITIAL_POLL_DELAY_MS);
    }

    const result = await queryOpenAiAsyncImageGeneration(params, taskId);
    onStatusChange?.(result.status);

    if (result.status === "SUCCESS") {
      return result.imageUrl;
    }

    if (result.status === "FAILURE") {
      throw new Error(result.errorMsg);
    }

    await sleep(OPENAI_ASYNC_POLL_INTERVAL_MS);
  }

  throw new Error(
    "Async image generation timed out. Remote task may still complete; use the task ID to check it in the upstream provider console.",
  );
}
