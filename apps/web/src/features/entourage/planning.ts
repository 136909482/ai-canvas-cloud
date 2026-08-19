import { executeChatPrompt } from "@/api/chatAdapter";
import type { EntourageFeature, EntouragePlacement } from "@/types";
import { createInlinePlanningImage } from "./planningImage";

export const ENTOURAGE_FEATURE_LABELS: Record<EntourageFeature, string> = {
  rich: "丰富配景",
  plants: "添加植物",
  people: "添加人物",
};

export function isWholeImageEntourageFeature(feature: EntourageFeature) {
  return feature === "rich" || feature === "plants" || feature === "people";
}

const PLANNING_SYSTEM_PROMPT = `你是一名建筑效果图配景规划专家。用户会提供一张建筑外景效果图，你需要分析画面中的空间、透视、光照和可放置区域，输出一份配景放置计划。

要求：
1. 只输出一个 JSON 对象，结构为 {"placements": [...]}，不要输出任何解释或代码块标记。
2. 每个放置物是一个对象：
   {
     "kind": "配景类型标识（英文小写）",
     "label": "配景中文名称",
     "box": [x1, y1, x2, y2],
     "prompt": "该配景的局部重绘提示词（中文，描述种类、形态、光影方向、透视匹配）"
   }
3. box 是相对整张图片的归一化坐标，取值 0~1：x 为水平方向（左 0 右 1），y 为垂直方向（上 0 下 1），[x1, y1] 是左上角，[x2, y2] 是右下角，必须满足 x1 < x2、y1 < y2。
4. 配景必须符合真实场景逻辑：底部贴地或贴附于地面/路径/花坛，不能悬浮在空中，不能遮挡建筑主体立面，尺寸与画面透视匹配。
5. 放置数量 2~4 个，位置分散，避免互相重叠。
6. prompt 要具体，包含植物/人物的种类、姿态、大小、光影方向（根据画面中的光源判断）。`;

const FEATURE_PLANNING_PROMPTS: Record<EntourageFeature, string> = {
  rich: `请为这张建筑外景效果图规划丰富配景：合理增加植物、少量人物和蓝天白云，保持建筑主体与道路结构稳定。`,
  plants: `请为这张建筑外景效果图规划"添加植物"配景：在地面、草地、花坛、道路两侧等合适位置放置树木、灌木或花草。
- 优先选择画面中空旷、单调的区域；
- 树木底部必须落在草地或土地上，树冠不遮挡建筑主要立面；
- 可包含不同高度的乔灌木搭配，丰富画面层次。`,
  people: `请为这张建筑外景效果图规划"添加人物"配景：在道路、广场、入口、平台等合适位置放置人物。
- 人物必须站立或行走在地面/路面上，脚部落地，不能悬浮；
- 人物尺度与建筑和画面比例匹配，近大远小符合透视；
- 可包含站立、行走、交谈等不同姿态，服装与场景氛围协调。`,
};

const MAX_PLACEMENTS = 4;

function clampBoxValue(value: number) {
  return Math.max(0, Math.min(1, value));
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return withoutFence.slice(start, end + 1);
}

export function parseEntouragePlan(text: string): EntouragePlacement[] {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  const placements = (parsed as { placements?: unknown })?.placements;
  if (!Array.isArray(placements)) return [];

  const result: EntouragePlacement[] = [];
  for (const item of placements) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const box = candidate.box;
    if (!Array.isArray(box) || box.length !== 4) continue;
    const numbers = box.map(Number);
    if (numbers.some((value) => !Number.isFinite(value))) continue;
    const [rawX1, rawY1, rawX2, rawY2] = numbers;
    if (!(rawX1 < rawX2) || !(rawY1 < rawY2)) continue;

    const kind =
      typeof candidate.kind === "string" ? candidate.kind.trim() : "item";
    const label =
      typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label.trim()
        : kind;
    const prompt =
      typeof candidate.prompt === "string" && candidate.prompt.trim()
        ? candidate.prompt.trim()
        : `添加${label}`;

    result.push({
      id: `${kind}-${result.length + 1}`,
      kind,
      label,
      box: [
        clampBoxValue(rawX1),
        clampBoxValue(rawY1),
        clampBoxValue(rawX2),
        clampBoxValue(rawY2),
      ],
      prompt,
    });

    if (result.length >= MAX_PLACEMENTS) break;
  }

  return result;
}

const FEATURE_EDIT_INSTRUCTIONS: Record<EntourageFeature, string> = {
  rich: "仅在蒙版透明区域增加植物、少量人物和蓝天白云，保持建筑主体与道路结构不变。",
  plants:
    "仅在蒙版透明区域添加植物配景（树木、灌木、花草等），植物底部贴地或贴附于地面/花坛，光影方向与画面一致，透视和尺度匹配，风格与效果图协调。严格保持蒙版外的建筑造型、立面、材质、门窗、背景、构图和所有原始像素不变，不得重建或改造建筑。",
  people:
    "仅在蒙版透明区域添加人物配景，人物脚部落地、姿态自然（站立/行走/交谈），尺度与建筑和画面比例匹配，光影方向与画面一致。严格保持蒙版外的建筑造型、立面、材质、门窗、背景、构图和所有原始像素不变，不得重建或改造建筑。",
};

const WHOLE_IMAGE_EDIT_INSTRUCTIONS: Record<EntourageFeature, string> = {
  rich: "保持建筑轮廓和道路不变。合理增加植物配景、少量真实可辨识的人物和蓝天白云；人物应有自然肤色、清晰服装与身体细节，姿态自然、脚部落地，尺度和光影与场景透视匹配，避免黑色剪影、纯黑影子或模糊无细节人物，不影响建筑",
  plants:
    "保持原图建筑主体轮廓、拍摄视角和道路结构不变。根据建筑类型、场地空间和画面透视，合理增加完整、自然、有层次的植物配景；形成乔木、灌木和地被的整体景观关系，保持入口通透，不影响建筑主体。",
  people:
    "保持建筑轮廓和道路不变。合理增加少量真实可辨识的街道人物。以建筑门洞、首层层高、台阶和铺装分格为尺度基准，成年人物按约1.7米表现，人物应显著小于首层层高；优先布置在入口及人行道的中景和远景，严格遵循近大远小，距离越远人物越小，避免画面前景出现占画面高度过大的近景人物。人物应有自然肤色、清晰服装与身体细节，姿态自然、脚部落地，光影与场景匹配，避免黑色剪影、纯黑影子或模糊无细节人物，不影响建筑",
};

export function buildWholeImageEntouragePrompt(feature: EntourageFeature) {
  return WHOLE_IMAGE_EDIT_INSTRUCTIONS[feature];
}

export function buildEntourageEditPrompt(
  feature: EntourageFeature,
  placements: EntouragePlacement[],
) {
  const details = placements
    .map(
      (placement, index) =>
        `${index + 1}. ${placement.label}（${placement.kind}）：${placement.prompt}`,
    )
    .join("\n");

  return `${FEATURE_EDIT_INSTRUCTIONS[feature]}\n放置明细：\n${details}`;
}

export async function planEntouragePlacements({
  imageUrl,
  feature,
  model,
}: {
  imageUrl: string;
  feature: EntourageFeature;
  model: Parameters<typeof executeChatPrompt>[0]["model"];
}): Promise<EntouragePlacement[]> {
  const planningImageUrl = await createInlinePlanningImage(imageUrl);
  const text = await executeChatPrompt({
    model,
    systemPrompt: PLANNING_SYSTEM_PROMPT,
    instructionPrompt: FEATURE_PLANNING_PROMPTS[feature],
    inputText: "",
    inputImageUrls: [planningImageUrl],
    outputFormat: "json",
  });
  return parseEntouragePlan(text);
}
