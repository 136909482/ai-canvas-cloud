import { validateProviderEndpoint } from "./providerEndpoint.ts";
import type {
  ApiConfig,
  ModelCategory,
  ModelEntry,
  ProviderProfileConfig,
  RuntimeModelConfig,
} from "../../types";

export const PROVIDER_CONFIG_MESSAGES = {
  emptyModelEntryId: "请先选择模型",
  emptyProviderProfile: "请先选择服务商",
  modelMissing: "当前任务使用的模型不存在",
  modelDisabled: "当前任务使用的模型已被禁用",
  modelMissingUpstream: "上游服务商中未找到当前模型",
  modelUnbound: "当前模型未绑定到此设备的服务商",
  providerProfileMissing: "当前模型对应的服务商不存在",
  providerProfileDisabled: "当前模型对应的服务商已被停用",
  customManifestMissing: "当前自定义服务商缺少有效的图片协议配置",
  providerCategoryMismatch: "当前模型与请求类型不匹配",
  emptyApiKey: "请先填写 API Key",
  emptyApiUrl: "请先填写 API 请求地址",
  invalidApiUrl: "请输入有效的 HTTP(S) endpoint",
  insecureApiUrl: "生产环境 endpoint 必须使用 HTTPS",
  apiUrlCredentials: "endpoint 不得包含用户名或密码",
  apiUrlFragment: "endpoint 不得包含 fragment",
} as const;

export type ProviderConfigIssueCode = keyof typeof PROVIDER_CONFIG_MESSAGES;
export type ProviderConfigField =
  "modelEntryId" | "providerProfile" | "apiKey" | "apiUrl";

export interface ProviderConfigDiagnostic {
  code: ProviderConfigIssueCode;
  field: ProviderConfigField;
  message: string;
}

export interface ResolveRuntimeModelConfigOptions {
  modelEntryId?: string | null;
  category?: ModelCategory;
  requireCredentials?: boolean;
}

export type RuntimeModelConfigResolution =
  | {
      ok: true;
      model: ModelEntry;
      profile: ProviderProfileConfig;
      runtimeConfig: RuntimeModelConfig;
    }
  | { ok: false; diagnostic: ProviderConfigDiagnostic };

const ISSUE_FIELDS: Record<ProviderConfigIssueCode, ProviderConfigField> = {
  emptyModelEntryId: "modelEntryId",
  emptyProviderProfile: "providerProfile",
  modelMissing: "modelEntryId",
  modelDisabled: "modelEntryId",
  modelMissingUpstream: "modelEntryId",
  modelUnbound: "modelEntryId",
  providerProfileMissing: "providerProfile",
  providerProfileDisabled: "providerProfile",
  customManifestMissing: "providerProfile",
  providerCategoryMismatch: "modelEntryId",
  emptyApiKey: "apiKey",
  emptyApiUrl: "apiUrl",
  invalidApiUrl: "apiUrl",
  insecureApiUrl: "apiUrl",
  apiUrlCredentials: "apiUrl",
  apiUrlFragment: "apiUrl",
};

function createDiagnostic(
  code: ProviderConfigIssueCode,
): ProviderConfigDiagnostic {
  return {
    code,
    field: ISSUE_FIELDS[code],
    message: PROVIDER_CONFIG_MESSAGES[code],
  };
}

export function getProviderConfigIssueMessage(code: ProviderConfigIssueCode) {
  return PROVIDER_CONFIG_MESSAGES[code];
}

export function validateModelDraftLike(
  model: Pick<ModelEntry, "modelId"> | null | undefined,
) {
  return model?.modelId.trim() ? null : createDiagnostic("emptyModelEntryId");
}

export function getModelDraftValidationMessage(
  model: Pick<ModelEntry, "modelId"> | null | undefined,
) {
  return validateModelDraftLike(model)?.message ?? "";
}

export function validateProviderProfileDraft(
  profile:
    Pick<ProviderProfileConfig, "baseUrl" | "authMode"> | null | undefined,
  apiKey: string,
  options?: { requireHttps?: boolean },
) {
  if (!profile) return createDiagnostic("emptyProviderProfile");
  if (profile.authMode !== "none" && !apiKey.trim())
    return createDiagnostic("emptyApiKey");

  const endpointValidation = validateProviderEndpoint(profile.baseUrl, {
    production: options?.requireHttps ?? Boolean(import.meta.env?.PROD),
  });
  if (!endpointValidation.ok) return createDiagnostic(endpointValidation.code);
  return null;
}

export function getProviderProfileValidationMessage(
  profile:
    Pick<ProviderProfileConfig, "baseUrl" | "authMode"> | null | undefined,
  apiKey: string,
) {
  return validateProviderProfileDraft(profile, apiKey)?.message ?? "";
}

export function resolveProviderApiUrl(
  profile: Pick<ProviderProfileConfig, "baseUrl">,
) {
  return profile.baseUrl.trim();
}

export function resolveRuntimeModelConfig(
  config: ApiConfig,
  options: ResolveRuntimeModelConfigOptions,
): RuntimeModelConfigResolution {
  const modelEntryId = options.modelEntryId?.trim() ?? "";
  if (!modelEntryId)
    return { ok: false, diagnostic: createDiagnostic("emptyModelEntryId") };

  const model = config.modelEntries.find((entry) => entry.id === modelEntryId);
  if (!model)
    return { ok: false, diagnostic: createDiagnostic("modelMissing") };
  if (options.category && model.category !== options.category) {
    return {
      ok: false,
      diagnostic: createDiagnostic("providerCategoryMismatch"),
    };
  }
  if (!model.enabled)
    return { ok: false, diagnostic: createDiagnostic("modelDisabled") };
  if (model.status === "unbound" || !model.providerProfileId) {
    return { ok: false, diagnostic: createDiagnostic("modelUnbound") };
  }
  if (model.status === "missing")
    return { ok: false, diagnostic: createDiagnostic("modelMissingUpstream") };

  const profile = config.providerProfiles.find(
    (candidate) => candidate.id === model.providerProfileId,
  );
  if (!profile)
    return {
      ok: false,
      diagnostic: createDiagnostic("providerProfileMissing"),
    };
  if (!profile.enabled)
    return {
      ok: false,
      diagnostic: createDiagnostic("providerProfileDisabled"),
    };
  if (
    profile.protocol === "custom-http-image-v1" &&
    model.category !== "image"
  ) {
    return {
      ok: false,
      diagnostic: createDiagnostic("providerCategoryMismatch"),
    };
  }

  const customManifest =
    profile.protocol === "custom-http-image-v1"
      ? config.customImageProviderManifests.find(
          (manifest) => manifest.id === profile.customManifestId,
        )
      : undefined;
  if (profile.protocol === "custom-http-image-v1" && !customManifest) {
    return {
      ok: false,
      diagnostic: createDiagnostic("customManifestMissing"),
    };
  }

  const apiKey = config.providerApiKeys[profile.id]?.trim() ?? "";
  const effectiveAuthMode =
    profile.protocol === "custom-http-image-v1" ? profile.authMode : "bearer";
  const effectiveImageRequestMode =
    profile.protocol === "custom-http-image-v1"
      ? profile.imageRequestMode
      : "sync";
  if (options.requireCredentials && effectiveAuthMode !== "none" && !apiKey)
    return { ok: false, diagnostic: createDiagnostic("emptyApiKey") };
  if (options.requireCredentials) {
    const endpointDiagnostic = validateProviderProfileDraft(
      { ...profile, authMode: effectiveAuthMode },
      apiKey,
    );
    if (endpointDiagnostic)
      return { ok: false, diagnostic: endpointDiagnostic };
  }

  return {
    ok: true,
    model,
    profile,
    runtimeConfig: {
      ...model,
      apiKey,
      baseUrl: resolveProviderApiUrl(profile),
      apiUrl: resolveProviderApiUrl(profile),
      provider:
        profile.protocol === "dashscope"
          ? "aliyun"
          : profile.protocol === "custom-http-image-v1"
            ? "custom"
            : "openai",
      protocol: profile.protocol,
      authMode: effectiveAuthMode,
      ...(customManifest ? { customManifest } : {}),
      imageRequestMode: effectiveImageRequestMode,
      requestMode: effectiveImageRequestMode,
    },
  };
}
