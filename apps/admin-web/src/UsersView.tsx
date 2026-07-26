import { useCallback, useEffect, useRef, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminManagedUserStatus,
  AdminManagedUserSummary,
  AdminUserVerificationFilter,
} from "@ai-canvas-cloud/contracts";
import {
  Button,
  Input,
  Select,
  Space,
  Table,
  Tooltip,
  type TableProps,
} from "antd";
import {
  ArrowRight,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  HardDrive,
  ListFilter,
  RefreshCw,
  RotateCcw,
  UserRound,
  UsersRound,
} from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import {
  AccessDenied,
  Feedback,
  PageHeader,
  UserStatusTag,
  VerificationTag,
} from "./components";
import { formatBytes, formatDateTime } from "./uiModel";

type UserFilters = {
  status: AdminManagedUserStatus | "all";
  verification: AdminUserVerificationFilter | "all";
  search: string;
};

function errorMessage(error: unknown) {
  return error instanceof AdminApiError
    ? error.message
    : "用户列表加载失败，请稍后重试";
}

function formatShare(value: number, total: number) {
  if (total === 0) return "暂无用户";
  return `占本页 ${Math.round((value / total) * 100)}%`;
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

  function clearFilters() {
    setSearchDraft("");
    resetPagination({ status: "all", verification: "all", search: "" });
  }

  const pageSummary = items.reduce(
    (summary, user) => ({
      active: summary.active + (user.status === "active" ? 1 : 0),
      verified: summary.verified + (user.emailVerified ? 1 : 0),
      workspaces: summary.workspaces + user.workspaceCount,
      storage: summary.storage + user.storageUsedBytes,
      sessions: summary.sessions + user.activeSessionCount,
    }),
    { active: 0, verified: 0, workspaces: 0, storage: 0, sessions: 0 },
  );
  const hasActiveFilters =
    filters.status !== "all" ||
    filters.verification !== "all" ||
    Boolean(filters.search);

  const columns: TableProps<AdminManagedUserSummary>["columns"] = [
    {
      title: "用户",
      key: "identity",
      width: 270,
      render: (_, user) => (
        <div className="table-user-identity">
          <span className="table-user-avatar" aria-hidden="true">
            <UserRound size={17} />
          </span>
          <div>
            <strong>{user.username}</strong>
            <span>{user.email}</span>
            <small>用户编号 {user.userNumber}</small>
          </div>
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (status: AdminManagedUserStatus) => (
        <UserStatusTag status={status} />
      ),
    },
    {
      title: "验证",
      dataIndex: "emailVerified",
      width: 90,
      responsive: ["md"],
      render: (verified: boolean) => <VerificationTag verified={verified} />,
    },
    {
      title: "工作区",
      dataIndex: "workspaceCount",
      width: 80,
      align: "right",
      responsive: ["lg"],
    },
    {
      title: "存储",
      dataIndex: "storageUsedBytes",
      width: 110,
      align: "right",
      responsive: ["lg"],
      render: (value: number) => (
        <code className="user-resource-value">{formatBytes(value)}</code>
      ),
    },
    {
      title: "有效会话",
      dataIndex: "activeSessionCount",
      width: 95,
      align: "right",
      responsive: ["xl"],
    },
    {
      title: "最近活动",
      dataIndex: "lastActiveAt",
      width: 168,
      responsive: ["md"],
      render: (value: string | null) => (
        <time className="user-last-active">{formatDateTime(value)}</time>
      ),
    },
    {
      title: "",
      key: "action",
      width: 84,
      fixed: "right",
      align: "right",
      render: (_, user) => (
        <Button
          className="user-detail-link"
          type="link"
          size="small"
          onClick={() => onSelectUser(user.id)}
        >
          查看 <ArrowRight size={14} />
        </Button>
      ),
    },
  ];

  if (!accessLoading && access && !access.can)
    return <AccessDenied message="当前角色无权读取用户运营摘要" />;

  return (
    <section className="admin-page users-page">
      <PageHeader
        title="用户管理"
        description="检索账号状态、身份验证与资源占用"
        extra={
          <Tooltip title="刷新用户列表">
            <Button
              icon={<RefreshCw size={17} />}
              loading={loading}
              onClick={() => void load()}
              aria-label="刷新用户列表"
            />
          </Tooltip>
        }
      />
      <Feedback error={error} />

      <section
        className="users-summary"
        aria-label="本页用户摘要"
        aria-busy={loading || accessLoading}
      >
        <article className="users-summary__item users-summary__item--blue">
          <span className="users-summary__icon">
            <UsersRound size={17} />
          </span>
          <div>
            <span>本页用户</span>
            <strong>{items.length}</strong>
            <small>当前第 {cursorHistory.length + 1} 页</small>
          </div>
        </article>
        <article className="users-summary__item users-summary__item--green">
          <span className="users-summary__icon">
            <CircleCheckBig size={17} />
          </span>
          <div>
            <span>正常账号</span>
            <strong>{pageSummary.active}</strong>
            <small>{formatShare(pageSummary.active, items.length)}</small>
          </div>
        </article>
        <article className="users-summary__item users-summary__item--teal">
          <span className="users-summary__icon">
            <BadgeCheck size={17} />
          </span>
          <div>
            <span>邮箱已验证</span>
            <strong>{pageSummary.verified}</strong>
            <small>{formatShare(pageSummary.verified, items.length)}</small>
          </div>
        </article>
        <article className="users-summary__item users-summary__item--gray">
          <span className="users-summary__icon">
            <HardDrive size={17} />
          </span>
          <div>
            <span>资源聚合</span>
            <strong>{formatBytes(pageSummary.storage)}</strong>
            <small>
              {pageSummary.workspaces} 工作区 · {pageSummary.sessions} 会话
            </small>
          </div>
        </article>
      </section>

      <section className="table-section users-directory">
        <header className="users-directory__header">
          <div>
            <h2>用户目录</h2>
            <p>当前筛选结果仅展示安全运营摘要</p>
          </div>
          <span>
            第 {cursorHistory.length + 1} 页 · {items.length} 位用户
          </span>
        </header>
        <div className="users-toolbar">
          <Input.Search
            className="user-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onSearch={() => resetPagination({ search: searchDraft.trim() })}
            maxLength={128}
            allowClear
            placeholder="搜索用户名、邮箱或 UID"
            enterButton="查询"
            aria-label="搜索用户"
          />
          <div className="users-filter-group">
            <span className="users-filter-group__label">
              <ListFilter size={15} />
              筛选
            </span>
            <Select
              className="users-filter-select"
              aria-label="账号状态"
              value={filters.status}
              onChange={(status: UserFilters["status"]) =>
                resetPagination({ status })
              }
              options={[
                { value: "all", label: "全部状态" },
                { value: "active", label: "正常" },
                { value: "disabled", label: "已封禁" },
                { value: "deleted", label: "已删除" },
              ]}
            />
            <Select
              className="users-filter-select users-filter-select--verification"
              aria-label="邮箱验证状态"
              value={filters.verification}
              onChange={(verification: UserFilters["verification"]) =>
                resetPagination({ verification })
              }
              options={[
                { value: "all", label: "全部验证状态" },
                { value: "verified", label: "已验证" },
                { value: "unverified", label: "未验证" },
              ]}
            />
            {hasActiveFilters ? (
              <Tooltip title="清除全部筛选">
                <Button
                  type="text"
                  icon={<RotateCcw size={15} />}
                  onClick={clearFilters}
                  aria-label="清除全部筛选"
                />
              </Tooltip>
            ) : null}
          </div>
        </div>
        <Table<AdminManagedUserSummary>
          className="users-table"
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading || accessLoading}
          pagination={false}
          tableLayout="fixed"
          scroll={{ x: 700 }}
          rowClassName={(user) => `users-table__row--${user.status}`}
          locale={{ emptyText: "没有匹配当前条件的用户" }}
        />
        <footer className="table-pagination">
          <span>第 {cursorHistory.length + 1} 页 · 每页最多 30 条</span>
          <Space size={8}>
            <Button
              icon={<ChevronLeft size={16} />}
              disabled={loading || cursorHistory.length === 0}
              onClick={() => {
                const previous = cursorHistory.at(-1) ?? null;
                setCursorHistory((current) => current.slice(0, -1));
                setCursor(previous);
              }}
            >
              上一页
            </Button>
            <Button
              disabled={loading || !nextCursor}
              onClick={() => {
                setCursorHistory((current) => [...current, cursor]);
                setCursor(nextCursor);
              }}
            >
              下一页 <ChevronRight size={16} />
            </Button>
          </Space>
        </footer>
      </section>
    </section>
  );
}
