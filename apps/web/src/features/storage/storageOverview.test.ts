import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStorageBytes,
  getStorageUsagePercentage,
} from "./storageOverview.ts";

test("formats storage sizes with compact binary units", () => {
  assert.equal(formatStorageBytes(0), "0 B");
  assert.equal(formatStorageBytes(1536), "1.5 KB");
  assert.equal(formatStorageBytes(1024 * 1024 * 394.2), "394.2 MB");
  assert.equal(formatStorageBytes(20 * 1024 * 1024 * 1024), "20 GB");
});

test("storage percentage is stable for empty and over-quota workspaces", () => {
  assert.equal(getStorageUsagePercentage(0, 100), 0);
  assert.equal(getStorageUsagePercentage(25, 100), 25);
  assert.equal(getStorageUsagePercentage(101, 100), 100);
});
