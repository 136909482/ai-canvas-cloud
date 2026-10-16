import {
  resolveOfficialImageParameterTemplate,
  type CreateOfficialImageTaskRequest,
  type OfficialImageParameterTemplate,
} from "@ai-canvas-cloud/contracts";

export type OfficialImageRequestSnapshot = CreateOfficialImageTaskRequest & {
  parameterTemplate?: OfficialImageParameterTemplate;
};

type InputImage = { bytes: Buffer; mimeType: string };

export function buildOfficialImageProviderRequest({
  request,
  modelId,
  size,
  inputs,
}: {
  request: OfficialImageRequestSnapshot;
  modelId: string;
  size: string;
  inputs: ReadonlyMap<string, InputImage>;
}): {
  operation: "generate" | "edit";
  contentType?: string;
  body: string | FormData;
} {
  const template = resolveOfficialImageParameterTemplate(
    request.parameterTemplate,
    modelId,
  );
  const orderedIds = [
    ...(request.inputAssetIds ?? []),
    request.editAssetId,
  ].filter((id): id is string => Boolean(id));
  const outputSettings =
    template === "gpt-image"
      ? {
          quality: request.quality ?? "auto",
          output_format: "png",
          ...(request.background && request.background !== "auto"
            ? { background: request.background }
            : {}),
        }
      : { response_format: "b64_json" };

  if (template === "nano-banana") {
    if (request.maskAssetId) throw new Error("Nano Banana 模板不支持蒙版重绘");
    return {
      operation: "generate",
      contentType: "application/json",
      body: JSON.stringify({
        model: modelId,
        prompt: request.prompt,
        response_format: "b64_json",
        image_size: request.resolution,
        ...(request.ratio === "Auto" ? {} : { aspect_ratio: request.ratio }),
        ...(orderedIds.length
          ? {
              image_urls: orderedIds.map((id) => {
                const image = inputs.get(id);
                if (!image)
                  throw new Error("Official task input image is unavailable");
                return `data:${image.mimeType};base64,${image.bytes.toString("base64")}`;
              }),
            }
          : {}),
      }),
    };
  }

  if (request.operationType === "generate" && inputs.size === 0) {
    return {
      operation: "generate",
      contentType: "application/json",
      body: JSON.stringify({
        model: modelId,
        prompt: request.prompt,
        ...(template === "generic" && request.negativePrompt
          ? { negative_prompt: request.negativePrompt }
          : {}),
        size,
        n: 1,
        ...outputSettings,
      }),
    };
  }

  const form = new FormData();
  for (const [key, value] of Object.entries({
    model: modelId,
    prompt: request.prompt,
    size,
    n: 1,
    ...outputSettings,
  })) {
    form.set(key, String(value));
  }
  const appendImage = (field: string, id: string, index: number) => {
    const image = inputs.get(id);
    if (!image) throw new Error("Official task input image is unavailable");
    const ext =
      image.mimeType === "image/jpeg"
        ? "jpg"
        : image.mimeType === "image/webp"
          ? "webp"
          : "png";
    form.append(
      field,
      new Blob([image.bytes], { type: image.mimeType }),
      `input-${index}.${ext}`,
    );
  };
  orderedIds.forEach((id, index) => appendImage("image", id, index));
  if (request.maskAssetId)
    appendImage("mask", request.maskAssetId, orderedIds.length);
  return { operation: "edit", body: form };
}
