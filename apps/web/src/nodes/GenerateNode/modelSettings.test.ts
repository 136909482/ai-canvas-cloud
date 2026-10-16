import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATE_OUTPUT_COUNTS,
  normalizeGenerateOutputCount,
  normalizeGptImageBackground,
} from "@/constants/generateNode";
import {
  getGenerateSettingsSummary,
  hasPromptRatio,
  shouldShowResolutionSettings,
} from "./modelSettings.ts";

test("GPT Image Auto hides resolution settings and omits K tier from summary", () => {
  assert.equal(shouldShowResolutionSettings(true, "Auto"), false);
  assert.equal(
    getGenerateSettingsSummary({
      isGptImageModel: true,
      ratio: "Auto",
      resolution: "4K",
      quality: "high",
    }),
    "自动 / 高质 / 1 张",
  );
});

test("background values default safely and non-default GPT backgrounds appear in the summary", () => {
  for (const value of [
    undefined,
    null,
    "auto",
    "unknown",
    "TRANSPARENT",
    false,
    1,
  ])
    assert.equal(normalizeGptImageBackground(value), "auto");
  assert.equal(normalizeGptImageBackground("transparent"), "transparent");
  assert.equal(normalizeGptImageBackground("opaque"), "opaque");
  const settings = {
    isGptImageModel: true,
    ratio: "Auto",
    resolution: "2K",
    quality: "auto" as const,
  };
  assert.equal(
    getGenerateSettingsSummary({ ...settings, showBackgroundSettings: true }),
    "自动 / 自动 / 1 张",
  );
  assert.equal(
    getGenerateSettingsSummary({
      ...settings,
      showBackgroundSettings: true,
      background: "transparent",
    }),
    "自动 / 自动 / 透明 / 1 张",
  );
  assert.equal(
    getGenerateSettingsSummary({ ...settings, background: "transparent" }),
    "自动 / 自动 / 1 张",
  );
});

test("GPT Image explicit ratios retain resolution settings and summary", () => {
  assert.equal(shouldShowResolutionSettings(true, "3:4"), true);
  assert.equal(
    getGenerateSettingsSummary({
      isGptImageModel: true,
      ratio: "3:4",
      resolution: "1K",
      quality: "auto",
    }),
    "3:4 / 1K / 自动 / 1 张",
  );
});

test("GPT Image Auto with a reference keeps the K tier control", () => {
  assert.equal(shouldShowResolutionSettings(true, "Auto", true), true);
  assert.equal(
    getGenerateSettingsSummary({
      isGptImageModel: true,
      ratio: "Auto",
      resolution: "2K",
      quality: "medium",
      hasAutoRatioSource: true,
    }),
    "自动 / 2K / 均衡 / 1 张",
  );
});

test("explicit prompt ratios keep the K tier control even without a reference", () => {
  assert.equal(hasPromptRatio("long strip, aspect ratio: 2:6"), true);
  assert.equal(shouldShowResolutionSettings(true, "Auto", true), true);
});

test("non-GPT image models keep resolution settings for Auto", () => {
  assert.equal(shouldShowResolutionSettings(false, "Auto"), true);
  assert.equal(
    getGenerateSettingsSummary({
      isGptImageModel: false,
      ratio: "Auto",
      resolution: "2K",
      quality: "auto",
    }),
    "自动 / 2K / 1 张",
  );
});

test("output count accepts only 1, 2 and 4, falling back to one for old or invalid data", () => {
  assert.deepEqual(GENERATE_OUTPUT_COUNTS, [1, 2, 4]);
  for (const count of GENERATE_OUTPUT_COUNTS)
    assert.equal(normalizeGenerateOutputCount(count), count);
  for (const count of [undefined, null, 0, -1, 3, 5, 2.5, "4", NaN, Infinity])
    assert.equal(normalizeGenerateOutputCount(count), 1);
});

test("settings summary includes the selected output count", () => {
  assert.equal(
    getGenerateSettingsSummary({
      isGptImageModel: false,
      ratio: "16:9",
      resolution: "2K",
      quality: "auto",
      outputCount: 4,
    }),
    "16:9 / 2K / 4 张",
  );
});
