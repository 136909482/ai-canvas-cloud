import { useCallback, useEffect, useMemo, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminManagedWorkspaceSummary,
  AdminUserDeletionPreview,
  AdminUserResponse,
} from "@ai-canvas-cloud/contracts";
import {
  Avatar,
  Button,
  Checkbox,
  Input,
  Modal,
  Skeleton,
  Space,
  Select,
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
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Unlock,
  UserRound,
  UserX,
  WandSparkles,
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

function generateRecoveryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
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
  const { data: credentialAccess } = useCan({
    resource: "users",
    action: "user.credentials.write",
  });
  const { data: deletionAccess } = useCan({
    resource: "users",
    action: "user.delete",
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
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [identityVerified, setIdentityVerified] = useState(false);
  const [passwordResetBusy, setPasswordResetBusy] = useState(false);
  const [deletionPreview, setDeletionPreview] =
    useState<AdminUserDeletionPreview | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionPreviewBusy, setDeletionPreviewBusy] = useState(false);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");
  const [confirmUserNumber, setConfirmUserNumber] = useState("");
  const [ownershipTransfers, setOwnershipTransfers] = useState<
    Record<string, string>
  >({});

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

  function clearPasswordReset() {
    setNewPassword("");
    setConfirmPassword("");
    setResetReason("");
    setIdentityVerified(false);
  }

  async function submitPasswordReset() {
    if (
      newPassword.length < 10 ||
      newPassword.length > 256 ||
      confirmPassword !== newPassword ||
      resetReason.trim().length < 3 ||
      !identityVerified
    )
      return;
    setPasswordResetBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.resetUserPassword(userId, {
        newPassword,
        reason: resetReason.trim(),
      });
      setNotice(
        `登录密码已重置，撤销 ${result.revokedSessionCount} 个会话；请通过可信渠道交付新密码`,
      );
      setPasswordResetOpen(false);
      clearPasswordReset();
      await load();
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? cause.message
          : "密码重置失败，请稍后重试",
      );
    } finally {
      setPasswordResetBusy(false);
    }
  }

  function clearDeletion() {
    setDeletionPreview(null);
    setDeletionReason("");
    setConfirmUserNumber("");
    setOwnershipTransfers({});
  }

  async function openDeletion() {
    setDeletionPreviewBusy(true);
    setError(null);
    setNotice(null);
    try {
      const preview = await adminApi.userDeletionPreview(userId);
      setDeletionPreview(preview);
      setOwnershipTransfers({});
      setDeletionOpen(true);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? cause.message
          : "无法加载注销预检，请稍后重试",
      );
    } finally {
      setDeletionPreviewBusy(false);
    }
  }

  const deletionReady =
    deletionReason.trim().length >= 3 &&
    confirmUserNumber.trim() === String(detail?.user.userNumber ?? "") &&
    Boolean(deletionPreview) &&
    deletionPreview!.ownedTeams.every(
      (team) => typeof ownershipTransfers[team.id] === "string",
    );

  async function submitDeletion() {
    if (!deletionPreview || !deletionReady) return;
    setDeletionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.deleteUser(userId, {
        reason: deletionReason.trim(),
        confirmUserNumber: deletionPreview.userNumber,
        ownershipTransfers: deletionPreview.ownedTeams.map((team) => ({
          workspaceId: team.id,
          successorUserId: ownershipTransfers[team.id]!,
        })),
      });
      setDeletionOpen(false);
      clearDeletion();
      setNotice(
        `注销已提交：已处理 ${result.personalWorkspaceCount} 个个人空间，个人数据将于 ${formatDateTime(result.purgeAfter)} 后清理。`,
      );
      window.setTimeout(onBack, 800);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? cause.message
          : "用户注销失败，请稍后重试",
      );
    } finally {
      setDeletionBusy(false);
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

          {credentialAccess?.can && detail.user.status !== "deleted" ? (
            <section className="user-recovery-panel">
              <div className="user-recovery-panel__intro">
                <span className="user-recovery-panel__icon">
                  <KeyRound size={18} />
                </span>
                <div>
                  <h2>账号恢复</h2>
                  <p>身份核验后设置新登录密码，并立即撤销全部旧会话</p>
                </div>
              </div>
              <Button
                type="primary"
                icon={<KeyRound size={16} />}
                onClick={() => setPasswordResetOpen(true)}
              >
                重置登录密码
              </Button>
            </section>
          ) : null}

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
                {deletionAccess?.can ? (
                  <Button
                    danger
                    icon={<UserX size={16} />}
                    loading={deletionPreviewBusy}
                    onClick={() => void openDeletion()}
                  >
                    注销用户
                  </Button>
                ) : null}
              </Space>
            </section>
          ) : null}
        </>
      )}

      <Modal
        open={passwordResetOpen}
        title="重置登录密码"
        okText="确认重置并强制下线"
        cancelText="取消"
        confirmLoading={passwordResetBusy}
        okButtonProps={{
          danger: true,
          disabled:
            newPassword.length < 10 ||
            newPassword.length > 256 ||
            confirmPassword !== newPassword ||
            resetReason.trim().length < 3 ||
            !identityVerified,
        }}
        onOk={() => void submitPasswordReset()}
        onCancel={() => {
          if (!passwordResetBusy) {
            setPasswordResetOpen(false);
            clearPasswordReset();
          }
        }}
        afterOpenChange={(open) => {
          if (!open && !passwordResetBusy) clearPasswordReset();
        }}
      >
        <p className="password-reset-warning">
          该操作将替换 {detail?.user.username ?? "此用户"}{" "}
          的现有登录密码，并撤销所有设备会话。密码不会出现在审计记录中。
        </p>
        <div className="password-reset-heading">
          <label className="modal-field-label" htmlFor="user-new-password">
            新登录密码
          </label>
          <Button
            type="link"
            size="small"
            icon={<WandSparkles size={14} />}
            onClick={() => {
              const generated = generateRecoveryPassword();
              setNewPassword(generated);
              setConfirmPassword(generated);
            }}
          >
            生成强密码
          </Button>
        </div>
        <Input.Password
          id="user-new-password"
          autoFocus
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          minLength={10}
          maxLength={256}
          placeholder="10-256 个字符"
          status={
            newPassword.length > 0 && newPassword.length < 10
              ? "error"
              : undefined
          }
        />
        <label className="modal-field-label" htmlFor="user-confirm-password">
          再次输入新密码
        </label>
        <Input.Password
          id="user-confirm-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          maxLength={256}
          placeholder="确认新密码"
          status={
            confirmPassword.length > 0 && confirmPassword !== newPassword
              ? "error"
              : undefined
          }
        />
        {confirmPassword.length > 0 && confirmPassword !== newPassword ? (
          <span className="password-reset-error">两次输入的密码不一致</span>
        ) : null}
        <label className="modal-field-label" htmlFor="password-reset-reason">
          恢复原因
        </label>
        <Input.TextArea
          id="password-reset-reason"
          value={resetReason}
          onChange={(event) => setResetReason(event.target.value)}
          minLength={3}
          maxLength={500}
          rows={3}
          showCount
          placeholder="请填写身份核验方式或工单依据"
          status={
            resetReason.length > 0 && resetReason.trim().length < 3
              ? "error"
              : undefined
          }
        />
        <Checkbox
          className="password-reset-confirmation"
          checked={identityVerified}
          onChange={(event) => setIdentityVerified(event.target.checked)}
        >
          已通过现有可信渠道核实用户身份
        </Checkbox>
      </Modal>

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

      <Modal
        open={deletionOpen}
        title="注销用户"
        okText="确认注销"
        cancelText="取消"
        confirmLoading={deletionBusy}
        okButtonProps={{ danger: true, disabled: !deletionReady }}
        onOk={() => void submitDeletion()}
        onCancel={() => {
          if (!deletionBusy) {
            setDeletionOpen(false);
            clearDeletion();
          }
        }}
        afterOpenChange={(open) => {
          if (!open && !deletionBusy) clearDeletion();
        }}
      >
        {deletionPreview ? (
          <>
            <p className="password-reset-warning">
              账号会立即失效并从所有设备退出。团队内容保持不变；
              {deletionPreview.personalWorkspaceCount} 个个人空间会进入 7
              天受控清理期，之后不可恢复。
            </p>
            {deletionPreview.ownedTeams.length > 0 ? (
              <div className="deletion-transfer-list">
                <label className="modal-field-label">团队所有权交接</label>
                {deletionPreview.ownedTeams.map((team) => (
                  <div className="deletion-transfer-row" key={team.id}>
                    <span>{team.name}</span>
                    <Select
                      aria-label={`${team.name} 的接任 owner`}
                      placeholder="选择接任成员"
                      value={ownershipTransfers[team.id]}
                      onChange={(value: string) =>
                        setOwnershipTransfers((current) => ({
                          ...current,
                          [team.id]: value,
                        }))
                      }
                      options={team.successors.map((successor) => ({
                        value: successor.id,
                        label: `${successor.username}（${successor.userNumber}）`,
                      }))}
                      status={
                        team.successors.length === 0 ||
                        !ownershipTransfers[team.id]
                          ? "error"
                          : undefined
                      }
                      disabled={team.successors.length === 0}
                    />
                    {team.successors.length === 0 ? (
                      <small>没有可接任的活跃成员，无法注销。</small>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <label className="modal-field-label" htmlFor="user-deletion-reason">
              注销原因
            </label>
            <Input.TextArea
              id="user-deletion-reason"
              value={deletionReason}
              onChange={(event) => setDeletionReason(event.target.value)}
              minLength={3}
              maxLength={500}
              rows={3}
              showCount
              status={
                deletionReason.length > 0 && deletionReason.trim().length < 3
                  ? "error"
                  : undefined
              }
            />
            <label className="modal-field-label" htmlFor="user-deletion-number">
              输入用户编号 {deletionPreview.userNumber} 以确认
            </label>
            <Input
              id="user-deletion-number"
              inputMode="numeric"
              value={confirmUserNumber}
              onChange={(event) => setConfirmUserNumber(event.target.value)}
              status={
                confirmUserNumber.length > 0 &&
                confirmUserNumber.trim() !== String(deletionPreview.userNumber)
                  ? "error"
                  : undefined
              }
            />
          </>
        ) : null}
      </Modal>
    </section>
  );
}
