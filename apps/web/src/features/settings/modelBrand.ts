type ModelBrandInput = {
  name?: string;
  displayName?: string;
  modelId?: string;
  apiUrl?: string;
};

export type ModelBrand =
  "anthropic" | "deepseek" | "gemini" | "openai" | "qwen" | "zhipu";

function getSearchableText(model: ModelBrandInput) {
  return [model.name, model.displayName, model.modelId, model.apiUrl]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getModelBrand(model: ModelBrandInput): ModelBrand | null {
  const searchableText = getSearchableText(model);
  const compactText = searchableText.replace(/[\s_-]/g, "");

  if (
    compactText.includes("nanobanana") ||
    searchableText.includes("gemini-3.1-flash-image-preview") ||
    searchableText.includes("gemini-3-pro-image-preview")
  ) {
    return "gemini";
  }

  if (
    searchableText.includes("claude") ||
    searchableText.includes("anthropic")
  ) {
    return "anthropic";
  }

  if (searchableText.includes("gemini")) return "gemini";
  if (searchableText.includes("deepseek")) return "deepseek";
  if (searchableText.includes("qwen") || searchableText.includes("tongyi")) {
    return "qwen";
  }

  if (
    searchableText.includes("glm") ||
    searchableText.includes("zhipu") ||
    searchableText.includes("\u667a\u8c31")
  ) {
    return "zhipu";
  }

  if (
    searchableText.includes("gpt") ||
    searchableText.includes("chatgpt") ||
    searchableText.includes("openai") ||
    searchableText.includes("dall-e") ||
    searchableText.includes("sora") ||
    searchableText.includes("codex") ||
    /(?:^|[^a-z0-9])o[134](?:[^a-z0-9]|$)/.test(searchableText)
  ) {
    return "openai";
  }

  return null;
}

export function isClaudeModel(model: ModelBrandInput) {
  return getModelBrand(model) === "anthropic";
}
