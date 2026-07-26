import type {
  AdminManagedUserStatus,
  AdminRole,
} from "@ai-canvas-cloud/contracts";

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "超级管理员",
  operator: "运营管理员",
  support: "支持人员",
  auditor: "审计员",
};

export const USER_STATUS_LABELS: Record<AdminManagedUserStatus, string> = {
  active: "正常",
  disabled: "已封禁",
  deleted: "已删除",
};

export function formatDateTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "-";
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatPercent(value: number, maximumFractionDigits = 1) {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  const fractionDigits =
    normalized > 0 && normalized < 0.1
      ? Math.max(2, maximumFractionDigits)
      : maximumFractionDigits;
  const formatted = normalized.toFixed(fractionDigits);
  return `${fractionDigits > 0 ? formatted.replace(/\.?0+$/, "") : formatted}%`;
}

export function formatBytes(value: number) {
  if (value < 1024) return `${formatNumber(value)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index]!;
  }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${unit}`;
}
