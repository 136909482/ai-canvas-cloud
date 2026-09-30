export function formatModelLabel(model: string, modelName?: string | null) {
  if (model.trim().toLowerCase() === "manual-edit") {
    return "图片编辑";
  }

  const normalizedModelName = modelName?.trim();
  if (normalizedModelName) {
    return normalizedModelName;
  }
  if (model.trim().toLowerCase().startsWith("official:")) {
    return "官方模型";
  }

  switch (model.toLowerCase()) {
    case "gpt-image-1":
      return "GPT Image 1";
    case "gpt-image-1-mini":
      return "GPT Image 1 Mini";
    case "gpt-image-1.5":
      return "GPT Image 1.5";
    case "gpt-image-2":
    case "gpt-img-2":
      return "GPT Image 2";
    case "mj":
      return "MJ";
    case "nano-banana-2":
      return "Nano Banana 2";
    case "nano-banana-pro":
      return "Nano Banana Pro";
    default:
      return model.toUpperCase();
  }
}

export function resolvePreviewModelLabel(
  model: string,
  persistedModelName?: string | null,
  configuredModelName?: string,
) {
  return formatModelLabel(
    model,
    persistedModelName?.trim() || configuredModelName,
  );
}
