import type { AdminRole } from "@ai-canvas-cloud/contracts";

export type AdminView = "dashboard" | "security" | "users" | "site" | "audit";

export interface AdminNavigationItem {
  key: AdminView;
  label: string;
  roles: readonly AdminRole[];
}

const ALL_ROLES: readonly AdminRole[] = [
  "super_admin",
  "operator",
  "support",
  "auditor",
];

export const ADMIN_NAVIGATION: readonly AdminNavigationItem[] = [
  { key: "dashboard", label: "运营概览", roles: ALL_ROLES },
  { key: "users", label: "用户管理", roles: ["super_admin", "support"] },
  { key: "site", label: "网站设置", roles: ["super_admin", "operator"] },
  { key: "audit", label: "管理审计", roles: ALL_ROLES },
  { key: "security", label: "安全状态", roles: ALL_ROLES },
];

export function navigationForRole(role: AdminRole) {
  return ADMIN_NAVIGATION.filter((item) => item.roles.includes(role));
}
