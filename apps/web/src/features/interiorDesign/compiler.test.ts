import assert from "node:assert/strict";
import test from "node:test";
import { INTERIOR_PRESETS, applyInteriorPreset } from "./catalog.ts";
import {
  compileInteriorDesignPrompt,
  createDefaultInteriorDesignConfig,
  getInteriorProviderRatio,
  normalizeInteriorDesignConfig,
  parseInteriorMaterialDefinition,
} from "./compiler.ts";

test("compiles all six presets into the fixed structured sections", () => {
  const initial = createDefaultInteriorDesignConfig();
  assert.equal(INTERIOR_PRESETS.length, 6);

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
  assert.equal(normalized.lighting.lightEntryEnabled, false);
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
    /每个值都必须是字符串/,
  );
});

test("maps original composition to provider Auto ratio", () => {
  assert.equal(getInteriorProviderRatio("original"), "Auto");
  assert.equal(getInteriorProviderRatio("16:9"), "16:9");
});
