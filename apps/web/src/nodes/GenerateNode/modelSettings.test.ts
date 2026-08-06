import assert from "node:assert/strict";
import test from "node:test";
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
    "自动 / 高质",
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
    "3:4 / 1K / 自动",
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
    "自动 / 2K / 均衡",
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
    "自动 / 2K",
  );
});
