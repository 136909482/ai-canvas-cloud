import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRelativeTime,
  getDevicePresentation,
} from "./devicePresentation.ts";
import {
  getLoginConflictPresentation,
  parseLoginConflictDetails,
} from "./loginConflict.ts";

test("device presentation keeps browser and operating system labels consistent", () => {
  assert.deepEqual(
    getDevicePresentation(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/150.0.0.0",
    ),
    {
      browser: "Edge",
      os: "Windows",
      title: "Edge on Windows",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/150.0.0.0",
      formFactor: "desktop",
    },
  );
});

test("relative activity time uses a deterministic reference time", () => {
  assert.equal(
    formatRelativeTime(
      "2026-08-01T07:58:00.000Z",
      new Date("2026-08-01T08:00:00.000Z").getTime(),
    ),
    "2 分钟前",
  );
});

test("login conflict details parse defensively and render known activity", () => {
  const conflict = parseLoginConflictDetails({
    activeDeviceLabel:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0",
    activeDeviceLastSeenAt: "2026-08-01T07:58:00.000Z",
  });

  assert.deepEqual(
    getLoginConflictPresentation(
      conflict,
      new Date("2026-08-01T08:00:00.000Z").getTime(),
    ),
    {
      title: "账号正在另一设备使用",
      activity: "Chrome on Windows · 最近活跃：2 分钟前",
    },
  );
});

test("missing or malformed conflict details fall back to unknown activity", () => {
  assert.deepEqual(
    getLoginConflictPresentation(
      parseLoginConflictDetails({
        activeDeviceLabel: 42,
        activeDeviceLastSeenAt: "not-a-date",
      }),
    ),
    {
      title: "账号已在其他设备登录",
      activity: "检测到另一有效登录，无法确认最近活跃时间。",
    },
  );
});
