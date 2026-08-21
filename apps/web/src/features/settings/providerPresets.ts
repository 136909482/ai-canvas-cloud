import type { ProviderProtocol } from "@/types";

export interface ProviderPreset {
  id: string;
  profileId: string;
  name: string;
  description: string;
  protocol: Extract<ProviderProtocol, "openai-compatible" | "dashscope">;
  baseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
}

export const PROVIDER_PRESETS = [
  {
    id: "deepseek",
    profileId: "builtin-provider-deepseek",
    name: "DeepSeek",
    description: "官方 API，支持 DeepSeek Chat 与 Reasoner",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com/zh-cn/",
  },
] as const satisfies readonly ProviderPreset[];

export function getProviderPresetById(id: string) {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function matchProviderPreset(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  return (
    PROVIDER_PRESETS.find(
      (preset) => preset.baseUrl.toLowerCase() === normalized,
    ) ?? null
  );
}

export function isBuiltInProviderProfile(profile: {
  id: string;
  baseUrl: string;
}) {
  return PROVIDER_PRESETS.some(
    (preset) =>
      preset.profileId === profile.id ||
      preset.baseUrl.toLowerCase() ===
        profile.baseUrl.trim().replace(/\/+$/, "").toLowerCase(),
  );
}

export function createBuiltInProviderProfiles(now = Date.now()) {
  return PROVIDER_PRESETS.map((preset) => ({
    id: preset.profileId,
    name: preset.name,
    protocol: preset.protocol,
    authMode: "bearer" as const,
    baseUrl: preset.baseUrl,
    enabled: true,
    imageRequestMode: "sync" as const,
    createdAt: now,
    updatedAt: now,
  }));
}
