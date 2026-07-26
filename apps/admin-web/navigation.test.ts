import assert from "node:assert/strict";
import test from "node:test";
import { navigationForRole } from "./src/navigation";
import {
  formatBytes,
  formatDateTime,
  formatPercent,
  ROLE_LABELS,
  USER_STATUS_LABELS,
} from "./src/uiModel";

test("admin navigation follows the existing RBAC projection", () => {
  assert.deepEqual(
    navigationForRole("super_admin").map((item) => item.key),
    ["dashboard", "users", "site", "smtp", "audit", "security"],
  );
  assert.deepEqual(
    navigationForRole("operator").map((item) => item.key),
    ["dashboard", "site", "audit", "security"],
  );
  assert.deepEqual(
    navigationForRole("support").map((item) => item.key),
    ["dashboard", "users", "audit", "security"],
  );
  assert.deepEqual(
    navigationForRole("auditor").map((item) => item.key),
    ["dashboard", "audit", "security"],
  );
});

test("admin labels cover every role and managed user status", () => {
  assert.deepEqual(Object.keys(ROLE_LABELS).sort(), [
    "auditor",
    "operator",
    "super_admin",
    "support",
  ]);
  assert.deepEqual(USER_STATUS_LABELS, {
    active: "正常",
    disabled: "已封禁",
    deleted: "已删除",
  });
});

test("admin formatters keep compact operational values readable", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.00 KiB");
  assert.equal(formatBytes(10 * 1024), "10.0 KiB");
  assert.equal(formatPercent(25, 0), "25%");
  assert.equal(formatPercent(20, 0), "20%");
  assert.equal(formatPercent(0.0089), "0.01%");
  assert.equal(formatDateTime(null), "-");
});
