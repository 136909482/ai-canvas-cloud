import type { ActiveSessionConflictDetails } from "@ai-canvas-cloud/contracts";
import {
  formatRelativeTime,
  getDevicePresentation,
} from "./devicePresentation";

export interface LoginConflict {
  activeDeviceLabel: string | null;
  activeDeviceLastSeenAt: string | null;
}

function readNullableString(
  value: unknown,
  options?: { requireValidDate?: boolean },
) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (
    options?.requireValidDate &&
    Number.isNaN(new Date(normalized).getTime())
  ) {
    return null;
  }

  return normalized;
}

export function parseLoginConflictDetails(
  details: Record<string, unknown> | undefined,
): LoginConflict {
  const candidate = details as
    Partial<ActiveSessionConflictDetails> | undefined;

  return {
    activeDeviceLabel: readNullableString(candidate?.activeDeviceLabel),
    activeDeviceLastSeenAt: readNullableString(
      candidate?.activeDeviceLastSeenAt,
      { requireValidDate: true },
    ),
  };
}

export function getLoginConflictPresentation(
  conflict: LoginConflict,
  now = Date.now(),
) {
  if (!conflict.activeDeviceLastSeenAt) {
    return {
      title: "账号已在其他设备登录",
      activity: "检测到另一有效登录，无法确认最近活跃时间。",
    };
  }

  const device = getDevicePresentation(conflict.activeDeviceLabel);
  return {
    title: "账号正在另一设备使用",
    activity: `${device.title} · 最近活跃：${formatRelativeTime(
      conflict.activeDeviceLastSeenAt,
      now,
    )}`,
  };
}
