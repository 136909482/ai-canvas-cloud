import assert from "node:assert/strict";
import test from "node:test";
import {
  createBuiltInProviderProfiles,
  getProviderPresetById,
  isBuiltInProviderProfile,
  matchProviderPreset,
} from "./providerPresets.ts";

test("DeepSeek preset uses the official OpenAI-compatible endpoint", () => {
  assert.deepEqual(getProviderPresetById("deepseek"), {
    id: "deepseek",
    profileId: "builtin-provider-deepseek",
    name: "DeepSeek",
    description: "官方 API，支持 DeepSeek Chat 与 Reasoner",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com/zh-cn/",
  });
});

test("built-in DeepSeek is available without user creation", () => {
  const [profile] = createBuiltInProviderProfiles(123);
  assert.deepEqual(profile, {
    id: "builtin-provider-deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    authMode: "bearer",
    baseUrl: "https://api.deepseek.com/v1",
    enabled: true,
    imageRequestMode: "sync",
    createdAt: 123,
    updatedAt: 123,
  });
  assert.equal(isBuiltInProviderProfile(profile), true);
});

test("provider preset matching tolerates a trailing slash", () => {
  assert.equal(
    matchProviderPreset("https://api.deepseek.com/v1/")?.id,
    "deepseek",
  );
  assert.equal(matchProviderPreset("https://example.com/v1"), null);
});
