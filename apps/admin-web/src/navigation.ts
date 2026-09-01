import type { AdminRole } from "@ai-canvas-cloud/contracts";

export type AdminView =
  | "dashboard"
  | "announcements"
  | "community"
  | "security"
  | "users"
  | "site"
  | "official-generation"
  | "storage"
  | "smtp"
  | "audit"
  | "updates";

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
  {
    key: "announcements",
    label: "站内通知",
    roles: ["super_admin", "operator"],
  },
  { key: "community", label: "社区审核", roles: ["super_admin", "operator"] },
  { key: "site", label: "网站设置", roles: ["super_admin", "operator"] },
  {
    key: "official-generation",
    label: "官方模型与积分",
    roles: ["super_admin"],
  },
  { key: "storage", label: "对象存储", roles: ["super_admin"] },
  { key: "smtp", label: "邮件服务", roles: ["super_admin"] },
  { key: "updates", label: "系统更新", roles: ["super_admin"] },
  { key: "audit", label: "管理审计", roles: ALL_ROLES },
  { key: "security", label: "安全状态", roles: ALL_ROLES },
];

export function navigationForRole(role: AdminRole) {
  return ADMIN_NAVIGATION.filter((item) => item.roles.includes(role));
}
