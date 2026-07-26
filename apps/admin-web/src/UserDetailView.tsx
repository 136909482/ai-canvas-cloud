import { useCallback, useEffect, useMemo, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminManagedWorkspaceSummary,
  AdminUserResponse,
} from "@ai-canvas-cloud/contracts";
import {
  Avatar,
  Button,
  Input,
  Modal,
  Skeleton,
  Space,
  Table,
  Tooltip,
  type TableProps,
} from "antd";
import {
  Activity,
  Ban,
  BriefcaseBusiness,
  CalendarDays,
  Database,
  Fingerprint,
  HardDrive,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Unlock,
  UserRound,
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

type PendingAction = "ban" | "unban" | "revoke-sessions";

const WORKSPACE_TYPE_LABELS: Record<
  AdminManagedWorkspaceSummary["type"],
  string
> = {
  personal: "个人空间",
  team: "团队空间",
};

const WORKSPACE_ROLE_LABELS: Record<
  AdminManagedWorkspaceSummary["role"],
  string
> = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "查看者",
};

const WORKSPACE_STATUS_LABELS: Record<
  AdminManagedWorkspaceSummary["status"],
  string
> = {
  active: "正常",
  disabled: "已停用",
  deleted: "已删除",
};

const ACTION_COPY: Record<
  PendingAction,
  { title: string; description: string; confirm: string }
> = {
  ban: {
    title: "封禁账号",
    description: "封禁会立即撤销全部会话，后续登录将被拒绝。",
    confirm: "确认封禁",
  },
  unban: {
    title: "解封账号",
    description: "解封不会恢复旧会话，用户需要重新登录。",
    confirm: "确认解封",
  },
  "revoke-sessions": {
    title: "撤销全部会话",
    description: "撤销后用户需要在所有设备重新登录。",
    confirm: "确认撤销",
  },
};

function workspaceStoragePercent(workspace: AdminManagedWorkspaceSummary) {
  if (workspace.storageQuotaBytes <= 0) return 0;
  const percentage =
    (workspace.storageUsedBytes / workspace.storageQuotaBytes) * 100;
  if (percentage <= 0) return 0;
  return Math.min(100, Math.max(1, percentage));
}

export function UserDetailView({
  userId,
  onBack,
}: {
  userId: string;
  onBack: () => void;
}) {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "users",
    action: "user.read",
  });
  const { data: writeAccess } = useCan({
    resource: "users",
    action: "user.write",
  });
  const [detail, setDetail] = useState<AdminUserResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!access?.can) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await adminApi.user(userId));
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? cause.message
          : "用户详情加载失败，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  }, [access?.can, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitAction() {
    if (!pendingAction || reason.trim().length < 3) return;
    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input = { reason: reason.trim() };
      const result =
        pendingAction === "ban"
          ? await adminApi.banUser(userId, input)
          : pendingAction === "unban"
            ? await adminApi.unbanUser(userId, input)
            : await adminApi.revokeUserSessions(userId, input);
      setNotice(
        pendingAction === "ban"
          ? `账号已封禁，撤销 ${result.revokedSessionCount} 个会话`
          : pendingAction === "unban"
            ? "账号已解封，用户需要重新登录"
            : `已撤销 ${result.revokedSessionCount} 个会话`,
      );
      setPendingAction(null);
      setReason("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? cause.message
          : "用户操作失败，请稍后重试",
      );
    } finally {
      setActionBusy(false);
    }
  }

  const workspaceColumns = useMemo<
    TableProps<AdminManagedWorkspaceSummary>["columns"]
  >(
    () => [
      {
        title: "工作区",
        key: "workspace",
        width: 280,
        render: (_, workspace) => (
          <div className="workspace-name">
            <span className="workspace-name__icon" aria-hidden="true">
              <BriefcaseBusiness size={16} />
            </span>
            <div>
              <strong>{workspace.name}</strong>
              <code>{workspace.id}</code>
            </div>
          </div>
        ),
      },
      {
        title: "归属",
        key: "membership",
        width: 126,
        responsive: ["md"],
        render: (_, workspace) => (
          <div className="workspace-membership">
            <strong>{WORKSPACE_TYPE_LABELS[workspace.type]}</strong>
            <span>{WORKSPACE_ROLE_LABELS[workspace.role]}</span>
          </div>
        ),
      },
      {
        title: "状态",
        dataIndex: "status",
        width: 92,
        responsive: ["lg"],
        render: (status: AdminManagedWorkspaceSummary["status"]) => (
          <span className={`workspace-status workspace-status--${status}`}>
            {WORKSPACE_STATUS_LABELS[status]}
          </span>
        ),
      },
      {
        title: "套餐",
        dataIndex: "planKey",
        width: 100,
        responsive: ["lg"],
        render: (planKey: string) => (
          <span className="workspace-plan">{planKey}</span>
        ),
      },
      {
        title: "存储使用",
        key: "storage",
        width: 210,
        render: (_, workspace) => (
          <div className="workspace-storage">
            <div>
              <strong>{formatBytes(workspace.storageUsedBytes)}</strong>
              <span>/ {formatBytes(workspace.storageQuotaBytes)}</span>
            </div>
            <div
              className="workspace-storage__track"
              role="progressbar"
              aria-label={`${workspace.name} 存储使用率`}
              aria-valuemin={0}
              aria-valuemax={workspace.storageQuotaBytes}
              aria-valuenow={Math.min(
                workspace.storageUsedBytes,
                workspace.storageQuotaBytes,
              )}
            >
              <i style={{ width: `${workspaceStoragePercent(workspace)}%` }} />
            </div>
          </div>
        ),
      },
      {
        title: "更新时间",
        dataIndex: "updatedAt",
        width: 170,
        responsive: ["xl"],
        render: (value: string) => formatDateTime(value),
      },
    ],
    [],
  );

  if (!accessLoading && access && !access.can)
    return <AccessDenied message="当前角色无权读取用户运营摘要" />;

  return (
    <section className="admin-page user-detail-page">
      <PageHeader
        title="用户详情"
        description={
          detail
            ? `用户编号 ${detail.user.userNumber} · 账号运营档案`
            : "账号身份、资源用量与工作区摘要"
        }
        onBack={onBack}
        extra={
          <Tooltip title="刷新用户详情">
            <Button
              icon={<RefreshCw size={17} />}
              loading={loading}
              onClick={() => void load()}
              aria-label="刷新用户详情"
            />
          </Tooltip>
        }
      />
      <Feedback error={error} success={notice} />

      {!detail ? (
        <div className="surface-section">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      ) : (
        <>
          <section className="user-profile-panel">
            <div className="user-profile-panel__main">
              <Avatar size={56} icon={<UserRound size={25} />} />
              <div className="user-profile-panel__identity">
                <span>NO. {detail.user.userNumber}</span>
                <h2>{detail.user.username}</h2>
                <p>{detail.user.email}</p>
              </div>
              <Space wrap size={6} className="user-profile-panel__tags">
                <UserStatusTag status={detail.user.status} />
                <VerificationTag verified={detail.user.emailVerified} />
              </Space>
            </div>
            <dl className="user-profile-panel__facts">
              <div>
                <dt>
                  <CalendarDays size={15} />
                  注册时间
                </dt>
                <dd>
                  <time>{formatDateTime(detail.user.createdAt)}</time>
                </dd>
              </div>
              <div>
                <dt>
                  <Activity size={15} />
                  最近活动
                </dt>
                <dd>
                  <time>{formatDateTime(detail.user.lastActiveAt)}</time>
                </dd>
              </div>
              <div className="user-profile-panel__fact-id">
                <dt>
                  <Fingerprint size={15} />
                  用户 ID
                </dt>
                <dd>
                  <code>{detail.user.id}</code>
                </dd>
              </div>
            </dl>
          </section>

          <section className="user-detail-metrics" aria-label="用户运营指标">
            <article className="user-detail-metric user-detail-metric--blue">
              <span className="user-detail-metric__icon">
                <Database size={18} />
              </span>
              <div>
                <span>工作区</span>
                <strong>{detail.user.workspaceCount}</strong>
                <small>当前关联的有效工作区</small>
              </div>
            </article>
            <article className="user-detail-metric user-detail-metric--teal">
              <span className="user-detail-metric__icon">
                <HardDrive size={18} />
              </span>
              <div>
                <span>已用存储</span>
                <strong>{formatBytes(detail.user.storageUsedBytes)}</strong>
                <small>跨工作区资源聚合</small>
              </div>
            </article>
            <article className="user-detail-metric user-detail-metric--green">
              <span className="user-detail-metric__icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <span>有效会话</span>
                <strong>{detail.user.activeSessionCount}</strong>
                <small>当前仍可访问账号</small>
              </div>
            </article>
          </section>

          <section className="table-section user-workspaces">
            <header className="user-workspaces__header">
              <div className="user-workspaces__title">
                <span className="user-workspaces__icon">
                  <BriefcaseBusiness size={17} />
                </span>
                <div>
                  <h2>工作区与存储</h2>
                  <p>仅展示成员关系、套餐和存储聚合</p>
                </div>
              </div>
              <span className="user-workspaces__count">
                {detail.workspaces.length} 个工作区
              </span>
            </header>
            <Table<AdminManagedWorkspaceSummary>
              className="workspace-table"
              rowKey="id"
              columns={workspaceColumns}
              dataSource={detail.workspaces}
              pagination={false}
              tableLayout="fixed"
              scroll={{ x: 760 }}
              locale={{ emptyText: "没有可展示的非删除工作区" }}
            />
          </section>

          {writeAccess?.can && detail.user.status !== "deleted" ? (
            <section className="user-control-panel">
              <div className="user-control-panel__intro">
                <span className="user-control-panel__icon">
                  <TriangleAlert size={18} />
                </span>
                <div>
                  <h2>账号控制</h2>
                  <p>操作必须填写原因，并写入不可修改的管理审计</p>
                </div>
              </div>
              <Space wrap size={8}>
                {detail.user.status === "disabled" ? (
                  <Button
                    icon={<Unlock size={16} />}
                    onClick={() => setPendingAction("unban")}
                  >
                    解封账号
                  </Button>
                ) : (
                  <Button
                    danger
                    icon={<Ban size={16} />}
                    onClick={() => setPendingAction("ban")}
                  >
                    封禁账号
                  </Button>
                )}
                <Button
                  danger
                  icon={<LogOut size={16} />}
                  onClick={() => setPendingAction("revoke-sessions")}
                >
                  撤销全部会话
                </Button>
              </Space>
            </section>
          ) : null}
        </>
      )}

      <Modal
        open={pendingAction !== null}
        title={pendingAction ? ACTION_COPY[pendingAction].title : ""}
        okText={pendingAction ? ACTION_COPY[pendingAction].confirm : "确认"}
        cancelText="取消"
        confirmLoading={actionBusy}
        okButtonProps={{
          danger:
            pendingAction === "ban" || pendingAction === "revoke-sessions",
          disabled: reason.trim().length < 3,
        }}
        onOk={() => void submitAction()}
        onCancel={() => {
          if (!actionBusy) {
            setPendingAction(null);
            setReason("");
          }
        }}
        afterOpenChange={(open) => {
          if (!open) setReason("");
        }}
      >
        {pendingAction ? <p>{ACTION_COPY[pendingAction].description}</p> : null}
        <label className="modal-field-label" htmlFor="user-action-reason">
          处理原因
        </label>
        <Input.TextArea
          id="user-action-reason"
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={3}
          maxLength={500}
          rows={4}
          showCount
          placeholder="请填写 3-500 字符的运营原因"
          status={
            reason.length > 0 && reason.trim().length < 3 ? "error" : undefined
          }
        />
      </Modal>
    </section>
  );
}
