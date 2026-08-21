import type {
  InteriorRefurnishBinding,
  InteriorRefurnishNodeData,
} from "@/types";

export const MAX_REFURNISH_PARTS = 15;
export const MAX_REFURNISH_PRODUCTS = 4;
export const MAX_REFURNISH_REQUIREMENTS = 300;

const DEFAULT_PARTS = [
  "天花板",
  "地面",
  "墙面",
  "背景墙",
  "窗帘",
  "沙发",
  "茶几",
  "灯具",
  "边几",
  "地毯",
  "装饰画",
  "绿植",
  "空调",
  "柜子",
  "摆饰品",
];

function cleanPart(value: unknown) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/[，,。；;：:]+$/g, "")
        .slice(0, 24)
    : "";
}

export function sanitizeParts(value: unknown, limit = MAX_REFURNISH_PARTS) {
  if (!Array.isArray(value)) return [];
  const parts: string[] = [];
  for (const item of value) {
    const part = cleanPart(item);
    if (part && !parts.includes(part)) parts.push(part);
    if (parts.length >= limit) break;
  }
  return parts;
}

export function parseRecognizedParts(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as {
      parts?: unknown;
    };
    return sanitizeParts(parsed.parts);
  } catch {
    return [];
  }
}

export function getAvailableRefurnishParts(
  recognizedParts: unknown,
  manualParts: unknown,
) {
  return sanitizeParts([
    ...sanitizeParts(recognizedParts),
    ...sanitizeParts(manualParts),
  ]);
}

export function sanitizeRefurnishBindings(
  value: unknown,
  productSourceOrder: string[],
) {
  if (!Array.isArray(value)) return [];
  const usedParts = new Set<string>();
  const bindings: InteriorRefurnishBinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const sourceNodeId =
      typeof record.sourceNodeId === "string" ? record.sourceNodeId : "";
    const partName = cleanPart(record.partName);
    if (
      !sourceNodeId ||
      !productSourceOrder.includes(sourceNodeId) ||
      !partName ||
      usedParts.has(partName)
    )
      continue;
    usedParts.add(partName);
    bindings.push({ sourceNodeId, partName });
  }
  return bindings.slice(0, MAX_REFURNISH_PRODUCTS);
}

export function createInteriorRefurnishNodeData(
  data?: Record<string, unknown>,
): InteriorRefurnishNodeData {
  const productSourceOrder = Array.isArray(data?.productSourceOrder)
    ? data.productSourceOrder
        .filter((item): item is string => typeof item === "string")
        .filter((item, index, items) => items.indexOf(item) === index)
        .slice(0, MAX_REFURNISH_PRODUCTS)
    : [];
  const recognitionStatus =
    data?.recognitionStatus === "recognizing" ||
    data?.recognitionStatus === "done" ||
    data?.recognitionStatus === "error"
      ? data.recognitionStatus
      : "idle";
  const status =
    data?.status === "queued" ||
    data?.status === "generating" ||
    data?.status === "done" ||
    data?.status === "error"
      ? data.status
      : "idle";
  return {
    schemaVersion: 1,
    sceneSourceNodeId:
      typeof data?.sceneSourceNodeId === "string"
        ? data.sceneSourceNodeId
        : null,
    productSourceOrder,
    bindings: sanitizeRefurnishBindings(data?.bindings, productSourceOrder),
    recognizedParts: sanitizeParts(data?.recognizedParts),
    manualParts: sanitizeParts(data?.manualParts),
    requirements:
      typeof data?.requirements === "string"
        ? data.requirements.slice(0, MAX_REFURNISH_REQUIREMENTS)
        : "",
    recognitionModel:
      typeof data?.recognitionModel === "string" ? data.recognitionModel : "",
    recognitionStatus,
    recognitionError:
      typeof data?.recognitionError === "string" ? data.recognitionError : "",
    model: typeof data?.model === "string" ? data.model : "",
    resolution:
      typeof data?.resolution === "string" &&
      ["1K", "2K", "4K"].includes(data.resolution)
        ? data.resolution
        : "1K",
    prompt: typeof data?.prompt === "string" ? data.prompt : "",
    imageUrl: typeof data?.imageUrl === "string" ? data.imageUrl : null,
    imageAsset: (data?.imageAsset && typeof data.imageAsset === "object"
      ? { ...(data.imageAsset as Record<string, unknown>) }
      : null) as InteriorRefurnishNodeData["imageAsset"],
    status,
    errorMsg: typeof data?.errorMsg === "string" ? data.errorMsg : "",
    activeTaskId:
      typeof data?.activeTaskId === "string" ? data.activeTaskId : null,
    autoResizeHeight:
      typeof data?.autoResizeHeight === "number" &&
      Number.isFinite(data.autoResizeHeight) &&
      data.autoResizeHeight >= 440 &&
      data.autoResizeHeight <= 4096
        ? Math.round(data.autoResizeHeight)
        : null,
  };
}

export function buildRefurnishPrompt(
  bindings: InteriorRefurnishBinding[],
  requirements: string,
) {
  const ordered = bindings.slice(0, MAX_REFURNISH_PRODUCTS);
  const replacements = ordered
    .map(
      (binding, index) =>
        `将图${index + 2}中的${binding.partName}完整、原样地替换到图1中${binding.partName}的位置`,
    )
    .join("；");
  const fusion = ordered
    .map(
      (binding, index) =>
        `图${index + 2}的新${binding.partName}必须与图1的尺度、透视、色调、材质质感和光影自然融合`,
    )
    .join("；");
  const extra = requirements.trim().slice(0, MAX_REFURNISH_REQUIREMENTS);
  return [
    `以图1为唯一基准场景，${replacements}。`,
    "严格保持图1原有构图、相机视角、透视关系、空间结构、光线、背景以及未指定的所有元素不变，只替换上述部位。",
    `${fusion}，看起来像原本就在场景中。`,
    "最终图片必须保持图1的宽高比和完整取景，不得裁切、扩图或改变房间结构。",
    extra ? `补充要求：${extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const REFURNISH_RECOGNITION_SYSTEM_PROMPT = `你是室内设计图片识别助手。识别画面中可替换的主要硬装和软装部件。只输出严格 JSON：{"parts":["部件名"]}。名称使用简洁中文，去重，只包含确实可见的大件，最多 15 项，不要输出坐标、解释或 Markdown。可优先识别：${DEFAULT_PARTS.join("、")}。`;
