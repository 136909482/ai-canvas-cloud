import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminManagedUserStatus,
  AdminManagedUserSummary,
  AdminUserVerificationFilter,
} from "@ai-canvas-cloud/contracts";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";
import { adminApi, AdminApiError } from "./api";

type UserFilters = {
  status: AdminManagedUserStatus | "all";
  verification: AdminUserVerificationFilter | "all";
  search: string;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index]!;
  }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${unit}`;
}

function formatDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function errorMessage(error: unknown) {
  return error instanceof AdminApiError
    ? error.message
    : "用户列表加载失败，请稍后重试";
}

export function UsersView({
  onSelectUser,
}: {
  onSelectUser: (userId: string) => void;
}) {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "users",
    action: "user.read",
  });
  const [items, setItems] = useState<AdminManagedUserSummary[]>([]);
  const [filters, setFilters] = useState<UserFilters>({
    status: "all",
    verification: "all",
    search: "",
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    if (!access?.can) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.users({
        cursor: cursor ?? undefined,
        limit: 30,
        status: filters.status === "all" ? undefined : filters.status,
        verification:
          filters.verification === "all" ? undefined : filters.verification,
        search: filters.search || undefined,
      });
      if (version !== requestVersion.current) return;
      setItems(response.items);
      setNextCursor(response.nextCursor);
    } catch (cause) {
      if (version === requestVersion.current) setError(errorMessage(cause));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [access?.can, cursor, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetPagination(next: Partial<UserFilters>) {
    setCursor(null);
    setCursorHistory([]);
    setFilters((current) => ({ ...current, ...next }));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    resetPagination({ search: searchDraft.trim() });
  }

  if (accessLoading)
    return (
      <div className="empty-state">
        <LoaderCircle className="spin" />
        正在核对权限
      </div>
    );
  if (!access?.can)
    return <div className="empty-state">当前角色无权读取用户运营摘要。</div>;

  return (
    <section className="workspace-view users-view">
      <div className="view-heading users-heading">
        <div>
          <span>ACCOUNT OPERATIONS / SAFE PROJECTION</span>
          <h1>用户管理</h1>
        </div>
        <button
          className="icon-command"
          type="button"
          onClick={() => void load()}
          title="刷新用户列表"
          disabled={loading}
        >
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className="users-intro">
        <UsersRound />
        <div>
          <strong>运营摘要，不是内容后台</strong>
          <p>仅显示账号、验证、工作区计数、存储用量和 session 聚合。</p>
        </div>
      </div>

      <form className="users-toolbar" onSubmit={submitSearch}>
        <label className="users-search">
          <Search />
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            maxLength={128}
            placeholder="用户编号、邮箱或显示名"
          />
          <button type="submit">查询</button>
        </label>
        <label>
          <span>账号状态</span>
          <select
            value={filters.status}
            onChange={(event) =>
              resetPagination({
                status: event.target.value as UserFilters["status"],
              })
            }
          >
            <option value="all">全部</option>
            <option value="active">正常</option>
            <option value="disabled">已封禁</option>
            <option value="deleted">已删除</option>
          </select>
        </label>
        <label>
          <span>邮箱验证</span>
          <select
            value={filters.verification}
            onChange={(event) =>
              resetPagination({
                verification: event.target.value as UserFilters["verification"],
              })
            }
          >
            <option value="all">全部</option>
            <option value="verified">已验证</option>
            <option value="unverified">未验证</option>
          </select>
        </label>
      </form>

      {error ? (
        <div className="error-notice" role="alert">
          {error}
        </div>
      ) : null}
      <div
        className={`users-table-wrap ${loading ? "is-loading" : ""}`}
        aria-busy={loading}
      >
        <table className="users-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>状态</th>
              <th>验证</th>
              <th>工作区</th>
              <th>存储</th>
              <th>有效会话</th>
              <th>最近活动</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {items.map((user) => (
              <tr key={user.id}>
                <td data-label="用户">
                  <div className="user-identity">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    <code>NO. {user.userNumber}</code>
                  </div>
                </td>
                <td data-label="状态">
                  <span className={`user-status ${user.status}`}>
                    {user.status === "active"
                      ? "正常"
                      : user.status === "disabled"
                        ? "已封禁"
                        : "已删除"}
                  </span>
                </td>
                <td data-label="验证">
                  <span
                    className={
                      user.emailVerified
                        ? "verification verified"
                        : "verification"
                    }
                  >
                    {user.emailVerified ? "已验证" : "未验证"}
                  </span>
                </td>
                <td data-label="工作区">{user.workspaceCount}</td>
                <td data-label="存储">
                  <code>{formatBytes(user.storageUsedBytes)}</code>
                </td>
                <td data-label="有效会话">{user.activeSessionCount}</td>
                <td data-label="最近活动">
                  <time>{formatDate(user.lastActiveAt)}</time>
                </td>
                <td data-label="操作">
                  <button
                    className="table-command"
                    type="button"
                    onClick={() => onSelectUser(user.id)}
                  >
                    查看
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 ? (
          <div className="empty-state">没有匹配当前条件的用户</div>
        ) : null}
      </div>

      <div className="users-pagination">
        <span>每页最多 30 条 · keyset 游标</span>
        <div>
          <button
            type="button"
            disabled={loading || cursorHistory.length === 0}
            onClick={() => {
              const previous = cursorHistory.at(-1) ?? null;
              setCursorHistory((current) => current.slice(0, -1));
              setCursor(previous);
            }}
          >
            <ChevronLeft />
            上一页
          </button>
          <button
            type="button"
            disabled={loading || !nextCursor}
            onClick={() => {
              setCursorHistory((current) => [...current, cursor]);
              setCursor(nextCursor);
            }}
          >
            下一页
            <ChevronRight />
          </button>
        </div>
      </div>
    </section>
  );
}
