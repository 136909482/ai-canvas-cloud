import { useEffect, useMemo, useState } from "react";
import type { AdminSessionResponse } from "@ai-canvas-cloud/contracts";
import { Alert, Button, Descriptions, Form, Input, Switch } from "antd";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { Feedback, PageHeader } from "./components";
import { formatDateTime, ROLE_LABELS } from "./uiModel";

type UsernameFields = { username: string };
type PasswordFields = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

function errorMessage(error: unknown) {
  return error instanceof AdminApiError
    ? error.message
    : "请求未完成，请稍后重试";
}

export function SecurityView({
  session,
  onSessionUpdated,
}: {
  session: AdminSessionResponse;
  onSessionUpdated: (session: AdminSessionResponse) => void;
}) {
  const [usernameForm] = Form.useForm<UsernameFields>();
  const [passwordForm] = Form.useForm<PasswordFields>();
  const [captchaEnabled, setCaptchaEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"username" | "password" | "captcha" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    usernameForm.setFieldValue("username", session.admin.username);
  }, [session.admin.username, usernameForm]);

  useEffect(() => {
    if (session.admin.role !== "super_admin") return;
    let active = true;
    void adminApi
      .loginSecuritySettings()
      .then((value) => {
        if (active) setCaptchaEnabled(value.captchaEnabled);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [session.admin.role]);

  const identityItems = useMemo(
    () => [
      { key: "realm", label: "身份域", children: "独立 Admin schema" },
      { key: "account", label: "管理员账号", children: session.admin.username },
      {
        key: "role",
        label: "当前角色",
        children: ROLE_LABELS[session.admin.role],
      },
      {
        key: "expires",
        label: "会话到期",
        children: formatDateTime(session.expiresAt),
      },
      {
        key: "id",
        label: "管理员 ID",
        children: <code>{session.admin.id}</code>,
      },
    ],
    [session],
  );

  async function toggleCaptcha(nextValue: boolean) {
    setBusy("captcha");
    setError(null);
    setNotice(null);
    try {
      const updated = await adminApi.updateLoginSecuritySettings(nextValue);
      setCaptchaEnabled(updated.captchaEnabled);
      setNotice(
        updated.captchaEnabled
          ? "登录验证码已开启，下次登录时生效"
          : "登录验证码已关闭",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function saveUsername(values: UsernameFields) {
    setBusy("username");
    setError(null);
    setNotice(null);
    try {
      const updated = await adminApi.updateUsername(values);
      onSessionUpdated(updated);
      setNotice("管理员账号已更新");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(values: PasswordFields) {
    setBusy("password");
    setError(null);
    setNotice(null);
    try {
      const updated = await adminApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      onSessionUpdated(updated);
      passwordForm.resetFields();
      setNotice("密码已更新，其他管理会话已撤销");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-page">
      <PageHeader
        title="安全状态"
        description="管理当前管理员身份、登录验证与凭据"
      />
      <Feedback error={error} success={notice} />

      <section className="surface-section">
        <div className="section-heading">
          <div className="section-heading__icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <h2>身份状态</h2>
            <p>当前会话与权限信息</p>
          </div>
        </div>
        <Descriptions bordered size="small" column={1} items={identityItems} />
      </section>

      {session.admin.role === "super_admin" ? (
        <section className="surface-section setting-row">
          <div>
            <h2>登录验证码</h2>
            <p>开启后，管理员登录时需要输入页面展示的 5 位验证码。</p>
          </div>
          <Switch
            aria-label="要求图片验证码"
            checked={captchaEnabled ?? false}
            loading={busy === "captcha" || captchaEnabled === null}
            disabled={busy !== null && busy !== "captcha"}
            onChange={(checked) => void toggleCaptcha(checked)}
            checkedChildren="开启"
            unCheckedChildren="关闭"
          />
        </section>
      ) : (
        <Alert type="info" showIcon message="登录验证码由超级管理员统一配置" />
      )}

      <div className="credential-layout">
        <section className="surface-section">
          <div className="section-heading">
            <div className="section-heading__icon">
              <UserRound size={18} />
            </div>
            <div>
              <h2>管理员账号</h2>
              <p>账号不使用邮箱，可以随时修改。</p>
            </div>
          </div>
          <Form
            form={usernameForm}
            layout="vertical"
            requiredMark={false}
            initialValues={{ username: session.admin.username }}
            onFinish={(values) => void saveUsername(values)}
          >
            <Form.Item
              label="登录账号"
              name="username"
              rules={[
                { required: true, message: "请输入登录账号" },
                { min: 3, max: 30, message: "账号长度应为 3-30 位" },
                {
                  pattern: /^[A-Za-z0-9_.]+$/,
                  message: "仅支持字母、数字、下划线和点",
                },
              ]}
            >
              <Input autoComplete="username" />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={busy === "username"}
              disabled={busy !== null}
            >
              保存账号
            </Button>
          </Form>
        </section>

        <section className="surface-section">
          <div className="section-heading">
            <div className="section-heading__icon">
              <KeyRound size={18} />
            </div>
            <div>
              <h2>修改密码</h2>
              <p>更新后保留当前会话并撤销其他会话。</p>
            </div>
          </div>
          <Form
            form={passwordForm}
            layout="vertical"
            requiredMark={false}
            onFinish={(values) => void savePassword(values)}
          >
            <Form.Item
              label="当前密码"
              name="currentPassword"
              rules={[{ required: true, message: "请输入当前密码" }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[
                { required: true, message: "请输入新密码" },
                { min: 12, message: "新密码至少需要 12 位" },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="确认新密码"
              name="confirmPassword"
              dependencies={["newPassword"]}
              rules={[
                { required: true, message: "请再次输入新密码" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return !value || getFieldValue("newPassword") === value
                      ? Promise.resolve()
                      : Promise.reject(new Error("两次输入的新密码不一致"));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={busy === "password"}
              disabled={busy !== null}
            >
              更新密码
            </Button>
          </Form>
        </section>
      </div>
    </section>
  );
}
