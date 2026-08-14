import assert from "node:assert/strict";
import test from "node:test";
import { INTERIOR_PRESETS, applyInteriorPreset } from "./catalog.ts";
import {
  applyInteriorLightingPatch,
  applyInteriorPhotographyPatch,
  applyInteriorScenePatch,
  compileInteriorDesignPrompt,
  createDefaultInteriorDesignConfig,
  getInteriorProviderRatio,
  normalizeInteriorDesignConfig,
  parseInteriorMaterialDefinition,
} from "./compiler.ts";

test("compiles all eighteen presets into the fixed structured sections", () => {
  const initial = createDefaultInteriorDesignConfig();
  assert.equal(INTERIOR_PRESETS.length, 18);

  for (const preset of INTERIOR_PRESETS) {
    const compiled = JSON.parse(
      compileInteriorDesignPrompt(applyInteriorPreset(initial, preset.id)),
    ) as Record<string, unknown>;
    assert.deepEqual(Object.keys(compiled), [
      "图生图任务指令",
      "场景类型",
      "光影氛围类型",
      "摄影参数",
      "核心约束",
      "出图参数",
    ]);
  }
});

test("migrates legacy light entry state to schema version two", () => {
  const legacy = structuredClone(
    createDefaultInteriorDesignConfig(),
  ) as unknown as {
    schemaVersion: number;
    lighting: Record<string, unknown>;
  };
  legacy.schemaVersion = 1;
  delete legacy.lighting.lightEntryMode;
  legacy.lighting.lightEntryEnabled = false;

  const migrated = normalizeInteriorDesignConfig(legacy).config;
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.lighting.lightEntryMode, "disabled");
  assert.deepEqual(normalizeInteriorDesignConfig(migrated).config, migrated);
});

test("presets preserve user photography materials output and requirements", () => {
  const initial = createDefaultInteriorDesignConfig();
  initial.photography.camera = "leica-m11";
  initial.constraints.materialDefinition = { 墙面: "石材" };
  initial.output.aspectRatio = "3:4";
  initial.customRequirement = "保留原画";

  const next = applyInteriorPreset(initial, "forced-left-lit");
  assert.equal(next.photography.camera, "leica-m11");
  assert.deepEqual(next.constraints.materialDefinition, { 墙面: "石材" });
  assert.equal(next.output.aspectRatio, "3:4");
  assert.equal(next.customRequirement, "保留原画");
  assert.equal(next.lighting.lightEntryMode, "forced-left");
  assert.equal(next.lighting.interiorLight, "all");
});

test("compiles every light entry direction with an exclusive instruction", () => {
  const expectations = {
    "detected-window": "真实存在的门窗",
    "forced-left": "画面左侧",
    "forced-right": "画面右侧",
    "forced-rear": "画面正后方",
    disabled: "关闭自然进光",
    custom: "用户指定的方向",
  } as const;

  for (const [mode, expected] of Object.entries(expectations)) {
    const config = createDefaultInteriorDesignConfig();
    config.lighting.lightEntryMode =
      mode as typeof config.lighting.lightEntryMode;
    const prompt = compileInteriorDesignPrompt(config);
    assert.match(prompt, new RegExp(expected));
    assert.equal(prompt, compileInteriorDesignPrompt(config));
  }
});

test("applies lighting curtain scene and phone camera intent-aware rules", () => {
  const initial = createDefaultInteriorDesignConfig();
  initial.lighting.weather = "rainy";
  initial.lighting.lightEntryMode = "disabled";

  const sunlight = applyInteriorLightingPatch(initial, {
    sunlightEffect: "tyndall",
  });
  assert.equal(sunlight.lighting.weather, "sunny");
  assert.equal(sunlight.lighting.lightEntryMode, "detected-window");

  const rainy = applyInteriorLightingPatch(sunlight, { weather: "rainy" });
  assert.equal(rainy.lighting.sunlightEffect, "none");

  const curtain = applyInteriorLightingPatch(initial, {
    sunlightEffect: "dream",
  });
  assert.equal(curtain.lighting.curtainType, "dream");

  const night = applyInteriorScenePatch(initial, {
    exteriorView: "city-night",
  });
  assert.equal(night.lighting.timeOfDay, "night");

  const phone = applyInteriorPhotographyPatch(initial, { camera: "iphone17" });
  assert.deepEqual(
    [
      phone.photography.aperture,
      phone.photography.shutterSpeed,
      phone.photography.iso,
    ],
    ["phone-f1.6", "1/60s", "50"],
  );
});

test("reports photography conflicts as non-blocking warnings", () => {
  const config = createDefaultInteriorDesignConfig();
  config.photography.shutterSpeed = "1/250s";
  config.photography.techniques = ["tripod"];
  config.lighting.occupants = "motion-person";

  const validation = normalizeInteriorDesignConfig(config);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 2);
  assert.match(validation.warnings.join(" "), /三脚架长曝光/);
  assert.match(validation.warnings.join(" "), /动态虚影人物/);
});

test("supports every source and both conversion goals deterministically", () => {
  const sourceTypes = [
    "sketchup",
    "kujiale",
    "3ds-max",
    "existing-render",
    "custom",
  ] as const;
  const goals = ["photoreal-photo", "realistic-visualization"] as const;

  for (const sourceSoftware of sourceTypes) {
    for (const conversionGoal of goals) {
      const config = createDefaultInteriorDesignConfig();
      config.sourceSoftware = sourceSoftware;
      config.customSourceSoftware = "Rhino";
      config.conversionGoal = conversionGoal;
      const first = compileInteriorDesignPrompt(config);
      assert.equal(first, compileInteriorDesignPrompt(config));
      assert.match(first, /图生图任务指令/);
    }
  }
});

test("normalizes enclosed spaces and disabled light entry", () => {
  const config = createDefaultInteriorDesignConfig();
  config.scene.spaceType = "basement-enclosed";
  config.lighting.sunlightEffect = "tree";
  config.lighting.interiorLight = "natural-only";

  const normalized = normalizeInteriorDesignConfig(config).config;
  assert.equal(normalized.scene.exteriorView, "enclosed");
  assert.equal(normalized.scene.location, "enclosed");
  assert.equal(normalized.lighting.lightEntryMode, "disabled");
  assert.equal(normalized.lighting.sunlightEffect, "none");
  assert.equal(normalized.lighting.interiorLight, "enclosed");
});

test("validates custom sources and material definition objects", () => {
  const config = createDefaultInteriorDesignConfig();
  config.sourceSoftware = "custom";
  assert.deepEqual(normalizeInteriorDesignConfig(config).errors, [
    "请填写模型图来源软件",
  ]);

  assert.deepEqual(parseInteriorMaterialDefinition('{"墙面":"哑光微水泥"}'), {
    墙面: "哑光微水泥",
  });
  assert.throws(
    () => parseInteriorMaterialDefinition('{"墙面":1}'),
    /格式不正确/,
  );
});

test("accepts categorized material results and repairs common model JSON mistakes", () => {
  const parsed = parseInteriorMaterialDefinition(`\n\`\`\`json
  {
    "墙面及立面": [
      {
        "元素名称": "床头背景墙木饰面",
        "材质类型": "木饰面板",
        "质感描述": "深胡桃木木纹质感",
        "表面特征": "平直木纹理",
        "反光特性": "弱反光",
      },
    ],
  }
  \`\`\``);

  assert.deepEqual(parsed, {
    "墙面及立面 / 床头背景墙木饰面":
      "木饰面板；深胡桃木木纹质感；平直木纹理；弱反光",
  });
});

test("keeps punctuation inside material strings while removing trailing commas", () => {
  assert.deepEqual(
    parseInteriorMaterialDefinition(
      '{"地面":[{"元素名称":"地砖","材质类型":"陶瓷, 哑光","质感描述":"细腻","表面特征":"平整","反光特性":"低反光",}],}',
    ),
    {
      "地面 / 地砖": "陶瓷, 哑光；细腻；平整；低反光",
    },
  );
});

test("shows a friendly message for material JSON that cannot be repaired", () => {
  assert.throws(
    () => parseInteriorMaterialDefinition('{"地面": [}'),
    /请直接粘贴完整结果/,
  );
});

test("maps original composition to provider Auto ratio", () => {
  assert.equal(getInteriorProviderRatio("original"), "Auto");
  assert.equal(getInteriorProviderRatio("16:9"), "16:9");
});
