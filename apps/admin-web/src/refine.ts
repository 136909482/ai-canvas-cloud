import type {
  AdminAuditEvent,
  AdminRole,
  AdminSessionResponse,
} from "@ai-canvas-cloud/contracts";
import type {
  AccessControlProvider,
  AuthProvider,
  BaseRecord,
  DataProvider,
  GetListParams,
} from "@refinedev/core";
import { adminApi } from "./api";

let identity: AdminSessionResponse | null = null;

export function setAdminIdentity(value: AdminSessionResponse | null) {
  identity = value;
}

function unsupported(): never {
  throw new Error("This Admin resource operation is not available");
}

export const adminDataProvider: DataProvider = {
  async getList<TData extends BaseRecord>({
    resource,
    pagination,
    filters,
  }: GetListParams) {
    if (resource !== "audit-events") unsupported();
    const actionFilter = filters?.find(
      (filter) => "field" in filter && filter.field === "action",
    );
    const resultFilter = filters?.find(
      (filter) => "field" in filter && filter.field === "result",
    );
    const payload = await adminApi.auditEvents({
      limit: pagination?.pageSize ?? 50,
      action:
        actionFilter &&
        "value" in actionFilter &&
        typeof actionFilter.value === "string"
          ? actionFilter.value
          : undefined,
      result:
        resultFilter &&
        "value" in resultFilter &&
        typeof resultFilter.value === "string"
          ? resultFilter.value
          : undefined,
    });
    return {
      data: payload.items as unknown as TData[],
      total: payload.items.length,
    };
  },
  async getOne<TData extends BaseRecord>() {
    return { data: unsupported() as TData };
  },
  async create<TData extends BaseRecord>() {
    return { data: unsupported() as TData };
  },
  async update<TData extends BaseRecord>() {
    return { data: unsupported() as TData };
  },
  async deleteOne<TData extends BaseRecord>() {
    return { data: unsupported() as TData };
  },
  getApiUrl: () => "/admin/v1",
};

export const adminAuthProvider: AuthProvider = {
  async login(params) {
    const username =
      typeof params?.username === "string" ? params.username : "";
    const password =
      typeof params?.password === "string" ? params.password : "";
    const response = await adminApi.login(username, password);
    setAdminIdentity(response.session);
    return { success: true, state: response.state, response };
  },
  async logout() {
    await adminApi.logout();
    setAdminIdentity(null);
    return { success: true };
  },
  async check() {
    try {
      const session = await adminApi.session();
      setAdminIdentity(session);
      return { authenticated: true };
    } catch {
      setAdminIdentity(null);
      return { authenticated: false };
    }
  },
  async onError(error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : 0;
    if (status === 401 || status === 403) setAdminIdentity(null);
    return { logout: status === 401 };
  },
  async getIdentity() {
    if (!identity) identity = await adminApi.session();
    return identity;
  },
  async getPermissions() {
    return identity?.admin.role ?? null;
  },
};

const PERMISSIONS: Record<AdminRole, ReadonlySet<string>> = {
  super_admin: new Set([
    "audit.read",
    "dashboard.read",
    "security.write",
    "site_config.write",
    "smtp_config.write",
    "object_storage_config.write",
    "asset_maintenance.write",
    "user.read",
    "user.write",
    "user.credentials.write",
    "user.delete",
  ]),
  operator: new Set(["audit.read", "dashboard.read", "site_config.write"]),
  support: new Set(["audit.read", "dashboard.read", "user.read", "user.write"]),
  auditor: new Set(["audit.read", "dashboard.read"]),
};

export const adminAccessControlProvider: AccessControlProvider = {
  async can({ action }) {
    const role = identity?.admin.role;
    return {
      can: Boolean(role && PERMISSIONS[role].has(action)),
      reason: "当前管理员角色无此权限",
    };
  },
  options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true } },
};

export type AuditRecord = AdminAuditEvent & BaseRecord;
