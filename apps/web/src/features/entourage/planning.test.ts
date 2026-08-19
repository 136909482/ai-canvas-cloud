import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEntourageEditPrompt,
  buildWholeImageEntouragePrompt,
  isWholeImageEntourageFeature,
  parseEntouragePlan,
  ENTOURAGE_FEATURE_LABELS,
} from "./planning";

test("parses a valid placement plan", () => {
  const text = JSON.stringify({
    placements: [
      {
        kind: "tree",
        label: "乔木",
        box: [0.1, 0.55, 0.3, 0.9],
        prompt: "一棵茂盛的乔木",
      },
      {
        kind: "person",
        label: "人物",
        box: [0.5, 0.7, 0.58, 0.92],
        prompt: "一位行走的成年人",
      },
    ],
  });

  const placements = parseEntouragePlan(text);
  assert.equal(placements.length, 2);
  assert.equal(placements[0]?.kind, "tree");
  assert.equal(placements[0]?.label, "乔木");
  assert.deepEqual(placements[0]?.box, [0.1, 0.55, 0.3, 0.9]);
  assert.equal(placements[0]?.id, "tree-1");
  assert.equal(placements[1]?.id, "person-2");
});

test("tolerates markdown code fences and surrounding text", () => {
  const text = `好的，以下是放置计划：

\`\`\`json
{"placements":[{"kind":"shrub","label":"灌木","box":[0.7,0.6,0.85,0.8],"prompt":"一丛灌木"}]}
\`\`\`
`;
  const placements = parseEntouragePlan(text);
  assert.equal(placements.length, 1);
  assert.equal(placements[0]?.kind, "shrub");
});

test("clamps box values into 0..1 and rejects invalid boxes", () => {
  const text = JSON.stringify({
    placements: [
      {
        kind: "tree",
        label: "乔木",
        box: [-0.2, 0.4, 1.4, 0.9],
        prompt: "树",
      },
      {
        kind: "bad",
        label: "反向框",
        box: [0.8, 0.8, 0.2, 0.9],
        prompt: "非法",
      },
      {
        kind: "missing",
        label: "缺框",
        prompt: "非法",
      },
    ],
  });

  const placements = parseEntouragePlan(text);
  assert.equal(placements.length, 1);
  assert.deepEqual(placements[0]?.box, [0, 0.4, 1, 0.9]);
});

test("fills missing kind/label/prompt with fallbacks", () => {
  const text = JSON.stringify({
    placements: [{ box: [0.1, 0.1, 0.2, 0.2] }],
  });
  const placements = parseEntouragePlan(text);
  assert.equal(placements.length, 1);
  assert.equal(placements[0]?.kind, "item");
  assert.equal(placements[0]?.label, "item");
  assert.equal(placements[0]?.prompt, "添加item");
});

test("caps the placement count and returns [] for unparseable text", () => {
  const placements = Array.from({ length: 8 }, (_, index) => ({
    kind: `k${index}`,
    label: `k${index}`,
    box: [index / 10, 0.1, (index + 1) / 10, 0.9],
    prompt: "p",
  }));
  assert.equal(parseEntouragePlan(JSON.stringify({ placements })).length, 4);
  assert.deepEqual(parseEntouragePlan("不是 JSON"), []);
  assert.deepEqual(parseEntouragePlan("{}"), []);
});

test("feature labels cover both entries", () => {
  assert.equal(ENTOURAGE_FEATURE_LABELS.rich, "丰富配景");
  assert.equal(ENTOURAGE_FEATURE_LABELS.plants, "添加植物");
  assert.equal(ENTOURAGE_FEATURE_LABELS.people, "添加人物");
});

test("rich and plant features use whole-image generation", () => {
  assert.equal(isWholeImageEntourageFeature("rich"), true);
  assert.equal(isWholeImageEntourageFeature("plants"), true);
  assert.equal(isWholeImageEntourageFeature("people"), true);
});

test("builds an edit prompt with per-placement details", () => {
  const prompt = buildEntourageEditPrompt("plants", [
    {
      id: "tree-1",
      kind: "tree",
      label: "乔木",
      box: [0.1, 0.5, 0.3, 0.9],
      prompt: "一棵茂盛的乔木",
    },
  ]);
  assert.ok(prompt.includes("添加植物配景"));
  assert.ok(prompt.includes("1. 乔木（tree）：一棵茂盛的乔木"));
});

test("builds a whole-image plant prompt without placement constraints", () => {
  const prompt = buildWholeImageEntouragePrompt("plants");

  assert.ok(prompt.includes("保持原图建筑主体轮廓"));
  assert.ok(prompt.includes("乔木、灌木和地被"));
  assert.ok(prompt.includes("保持入口通透"));
  assert.equal(prompt.includes("2~4"), false);
  assert.equal(prompt.includes("蒙版"), false);
});

test("builds the rich entourage prompt with realistic people", () => {
  const prompt = buildWholeImageEntouragePrompt("rich");

  assert.equal(
    prompt,
    "保持建筑轮廓和道路不变。合理增加植物配景、少量真实可辨识的人物和蓝天白云；人物应有自然肤色、清晰服装与身体细节，姿态自然、脚部落地，尺度和光影与场景透视匹配，避免黑色剪影、纯黑影子或模糊无细节人物，不影响建筑",
  );
  assert.equal(prompt.includes("蒙版"), false);
  assert.equal(prompt.includes("真实可辨识的人物"), true);
  assert.equal(prompt.includes("避免黑色剪影"), true);
});

test("builds the people prompt with realistic street people", () => {
  const prompt = buildWholeImageEntouragePrompt("people");

  assert.equal(
    prompt,
    "保持建筑轮廓和道路不变。合理增加少量真实可辨识的街道人物。以建筑门洞、首层层高、台阶和铺装分格为尺度基准，成年人物按约1.7米表现，人物应显著小于首层层高；优先布置在入口及人行道的中景和远景，严格遵循近大远小，距离越远人物越小，避免画面前景出现占画面高度过大的近景人物。人物应有自然肤色、清晰服装与身体细节，姿态自然、脚部落地，光影与场景匹配，避免黑色剪影、纯黑影子或模糊无细节人物，不影响建筑",
  );
  assert.equal(prompt.includes("蒙版"), false);
  assert.equal(prompt.includes("坐标"), false);
  assert.equal(prompt.includes("真实可辨识"), true);
  assert.equal(prompt.includes("首层层高"), true);
  assert.equal(prompt.includes("严格遵循近大远小"), true);
  assert.equal(prompt.includes("过大的近景人物"), true);
  assert.equal(prompt.includes("避免黑色剪影"), true);
});
