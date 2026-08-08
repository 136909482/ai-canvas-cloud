import {
  generateImage,
  submitAsyncImageGeneration,
  waitForAsyncImageGeneration,
  type GenerateImageParams,
} from "@/api/imageAdapter";
import type {
  GenerateTaskAdapterId,
  GenerateTaskExecutionMode,
  GenerateTaskRemoteStatus,
  ModelCategory,
  RuntimeModelConfig,
} from "@/types";
import {
  startCustomImageGeneration,
  waitForCustomImageGeneration,
} from "@/api/image/custom";

export type ImageProviderAdapterId = Exclude<
  GenerateTaskAdapterId,
  "dashscope-video-polling"
>;

export type ImageExecutionStart =
  | { type: "completed"; output: string }
  | { type: "remote"; remoteTaskId: string };

export interface ImageProviderAdapter {
  id: ImageProviderAdapterId;
  executionMode: GenerateTaskExecutionMode;
  start(params: GenerateImageParams): Promise<ImageExecutionStart>;
  waitForRemote?: (
    params: GenerateImageParams,
    remoteTaskId: string,
    onStatusChange?: (status: GenerateTaskRemoteStatus) => void,
  ) => Promise<string>;
}

function hashBinding(parts: Array<string | number | null | undefined>) {
  const value = parts.map((part) => String(part ?? "")).join("\u0000");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }

  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function resolveTaskAdapterId(
  modelConfig: RuntimeModelConfig,
  category: ModelCategory,
): GenerateTaskAdapterId {
  if (category === "video") {
    return "dashscope-video-polling";
  }

  if (modelConfig.protocol === "custom-http-image-v1") {
    return "custom-http-image-v1";
  }

  if (modelConfig.protocol === "openai-compatible") {
    return modelConfig.requestMode === "async"
      ? "openai-compatible-task-polling"
      : "openai-compatible-sync";
  }

  return "dashscope-image-sync";
}

export function resolveTaskExecutionMode(
  modelConfig: RuntimeModelConfig,
  category: ModelCategory,
): GenerateTaskExecutionMode {
  if (category === "video") return "polling";
  return modelConfig.requestMode === "async" ? "polling" : "sync";
}

export function createProviderBindingFingerprint(
  modelConfig: RuntimeModelConfig,
  profileUpdatedAt: number,
  category: ModelCategory,
) {
  return hashBinding([
    category,
    resolveTaskAdapterId(modelConfig, category),
    modelConfig.id,
    modelConfig.providerProfileId,
    modelConfig.modelId,
    modelConfig.baseUrl,
    modelConfig.apiKey,
    modelConfig.protocol,
    modelConfig.authMode,
    modelConfig.customManifest
      ? JSON.stringify(modelConfig.customManifest)
      : null,
    modelConfig.updatedAt,
    profileUpdatedAt,
  ]);
}

const syncOpenAiAdapter: ImageProviderAdapter = {
  id: "openai-compatible-sync",
  executionMode: "sync",
  async start(params) {
    return { type: "completed", output: await generateImage(params) };
  },
};

const syncDashscopeAdapter: ImageProviderAdapter = {
  id: "dashscope-image-sync",
  executionMode: "sync",
  async start(params) {
    return { type: "completed", output: await generateImage(params) };
  },
};

const pollingOpenAiAdapter: ImageProviderAdapter = {
  id: "openai-compatible-task-polling",
  executionMode: "polling",
  async start(params) {
    const submission = await submitAsyncImageGeneration(params);
    return { type: "remote", remoteTaskId: submission.taskId };
  },
  waitForRemote: waitForAsyncImageGeneration,
};

const customHttpImageAdapter: ImageProviderAdapter = {
  id: "custom-http-image-v1",
  executionMode: "polling",
  start: startCustomImageGeneration,
  waitForRemote: waitForCustomImageGeneration,
};

const imageProviderAdapters: Record<
  ImageProviderAdapterId,
  ImageProviderAdapter
> = {
  "openai-compatible-sync": syncOpenAiAdapter,
  "openai-compatible-task-polling": pollingOpenAiAdapter,
  "dashscope-image-sync": syncDashscopeAdapter,
  "custom-http-image-v1": customHttpImageAdapter,
};

export function getImageProviderAdapter(id: GenerateTaskAdapterId) {
  if (id === "dashscope-video-polling") {
    throw new Error("视频任务不能使用图片 Provider 适配器");
  }

  return imageProviderAdapters[id];
}
