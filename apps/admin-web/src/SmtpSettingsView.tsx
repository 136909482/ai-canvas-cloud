import { useEffect, useRef, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  SmtpSecurityMode,
  SmtpSettingsInput,
  SmtpSettingsResponse,
} from "@ai-canvas-cloud/contracts";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Skeleton,
  Space,
  Tag,
} from "antd";
import {
  CircleStop,
  MailCheck,
  PlugZap,
  Save,
  Send,
  ServerCog,
} from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { AccessDenied, Feedback, PageHeader } from "./components";

interface SmtpFormFields {
  host: string;
  port: number;
  securityMode: SmtpSecurityMode;
  username: string;
  password?: string;
  fromEmail: string;
  fromName: string;
}

type BusyAction = "connection" | "email" | "save" | "disable" | null;

const STATUS_PRESENTATION = {
  unconfigured: { color: "default", label: "未配置" },
  active: { color: "success", label: "已启用" },
  disabled: { color: "warning", label: "已停用" },
} as const;

const ERROR_MESSAGES: Record<string, string> = {
  SMTP_CONFIG_CONFLICT: "SMTP 配置已被更新，请刷新后重试。",
  SMTP_HOST_NOT_ALLOWED: "SMTP 主机必须解析到公网地址。",
  SMTP_DNS_FAILED: "无法解析 SMTP 主机。",
  SMTP_CONNECTION_FAILED: "无法连接 SMTP 服务，请检查主机和端口。",
  SMTP_TLS_FAILED: "TLS 连接验证失败，请检查连接安全模式。",
  SMTP_AUTH_FAILED: "SMTP 认证失败，请检查用户名和密码或授权码。",
  SMTP_SENDER_REJECTED: "SMTP 服务拒绝了发件人地址。",
  SMTP_RECIPIENT_REJECTED: "SMTP 服务拒绝了测试收件人。",
  SMTP_RATE_LIMITED: "测试操作过于频繁，请稍后再试。",
};

function errorMessage(error: unknown) {
  if (error instanceof AdminApiError) {
    return ERROR_MESSAGES[error.code] ?? error.message;
  }
  return "SMTP 请求未完成，请稍后重试。";
}

function isFormValidationError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "errorFields" in error &&
    Array.isArray(error.errorFields),
  );
}

function formValues(settings: SmtpSettingsResponse): SmtpFormFields {
  return {
    host: settings.host ?? "",
    port: settings.port ?? 465,
    securityMode: settings.securityMode ?? "implicit_tls",
    username: settings.username ?? "",
    fromEmail: settings.fromEmail ?? "",
    fromName: settings.fromName ?? "AI Canvas",
  };
}

export function SmtpSettingsView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "smtp-settings",
    action: "smtp_config.write",
  });
  const [form] = Form.useForm<SmtpFormFields>();
  const [testForm] = Form.useForm<{ recipient: string }>();
  const [settings, setSettings] = useState<SmtpSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const portEdited = useRef(false);

  useEffect(() => {
    if (!access?.can) return;
    let active = true;
    void adminApi
      .smtpSettings()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [access?.can]);

  useEffect(() => {
    if (settings) form.setFieldsValue(formValues(settings));
  }, [form, settings]);

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  function inputFrom(values: SmtpFormFields): SmtpSettingsInput {
    return {
      host: values.host,
      port: values.port,
      securityMode: values.securityMode,
      username: values.username,
      ...(values.password ? { password: values.password } : {}),
      fromEmail: values.fromEmail,
      fromName: values.fromName,
      expectedRevisionId: settings?.revisionId ?? null,
    };
  }

  async function currentInput() {
    return inputFrom(await form.validateFields());
  }

  async function testConnection() {
    setBusy("connection");
    clearFeedback();
    try {
      await adminApi.testSmtpConnection(await currentInput());
      setNotice("SMTP 连接和身份认证成功。");
    } catch (cause) {
      if (!isFormValidationError(cause)) setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function sendTestEmail() {
    setBusy("email");
    clearFeedback();
    try {
      const [{ recipient }, input] = await Promise.all([
        testForm.validateFields(),
        currentInput(),
      ]);
      await adminApi.testSmtpEmail({ ...input, recipient });
      setNotice("测试邮件已提交发送，请检查收件箱。");
    } catch (cause) {
      if (!isFormValidationError(cause)) setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    clearFeedback();
    try {
      const updated = await adminApi.publishSmtpSettings(await currentInput());
      setSettings(updated);
      form.setFieldsValue({ ...formValues(updated), password: undefined });
      setDirty(false);
      portEdited.current = false;
      setNotice("SMTP 配置已验证并启用。");
    } catch (cause) {
      if (!isFormValidationError(cause)) setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  function disable() {
    if (!settings?.revisionId) return;
    Modal.confirm({
      title: "停用邮件服务？",
      content: "停用后，邮箱验证和密码重置邮件将无法发送。",
      okText: "停用",
      okButtonProps: { danger: true },
      cancelText: "取消",
      async onOk() {
        setBusy("disable");
        clearFeedback();
        try {
          const updated = await adminApi.disableSmtpSettings({
            expectedRevisionId: settings.revisionId!,
          });
          setSettings(updated);
          setDirty(false);
          setNotice("SMTP 邮件服务已停用。");
        } catch (cause) {
          setError(errorMessage(cause));
        } finally {
          setBusy(null);
        }
      },
    });
  }

  if (accessLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!access?.can)
    return <AccessDenied message="当前管理员无权配置邮件服务" />;
  const status = STATUS_PRESENTATION[settings?.state ?? "unconfigured"];
  const canPreservePassword = settings?.source === "managed";

  return (
    <section className="admin-page smtp-settings-page">
      <PageHeader
        title="邮件服务"
        description="管理邮箱验证与密码重置使用的 SMTP 发送通道"
        extra={
          <Space size={8} wrap>
            <Tag color={status.color} className="smtp-status-tag">
              {status.label}
            </Tag>
            <Button
              icon={<PlugZap size={16} />}
              loading={busy === "connection"}
              disabled={loading || (busy !== null && busy !== "connection")}
              onClick={() => void testConnection()}
            >
              测试连接
            </Button>
          </Space>
        }
      />
      <Feedback error={error} success={notice} />

      <section className="surface-section smtp-config-section">
        <div className="section-heading">
          <div className="section-heading__icon">
            <ServerCog size={18} />
          </div>
          <div>
            <h2>SMTP 配置</h2>
            <p>全站认证邮件发送凭据</p>
          </div>
        </div>
        {loading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : (
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onValuesChange={() => setDirty(true)}
          >
            <div className="smtp-form-grid">
              <Form.Item
                label="SMTP 主机"
                name="host"
                rules={[{ required: true, message: "请输入 SMTP 主机" }]}
              >
                <Input autoComplete="off" placeholder="smtp.example.com" />
              </Form.Item>
              <Form.Item
                label="SMTP 端口"
                name="port"
                rules={[
                  { required: true, message: "请输入 SMTP 端口" },
                  {
                    validator: (_, value) =>
                      [25, 465, 587, 2525].includes(value)
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error("仅支持 25、465、587 或 2525 端口"),
                          ),
                  },
                ]}
              >
                <InputNumber
                  controls
                  min={1}
                  max={65535}
                  onChange={() => {
                    portEdited.current = true;
                  }}
                />
              </Form.Item>
              <Form.Item
                label="连接安全"
                name="securityMode"
                rules={[{ required: true }]}
              >
                <Segmented
                  block
                  options={[
                    { label: "SSL/TLS", value: "implicit_tls" },
                    { label: "STARTTLS", value: "starttls" },
                  ]}
                  onChange={(value) => {
                    if (!portEdited.current) {
                      form.setFieldValue(
                        "port",
                        value === "implicit_tls" ? 465 : 587,
                      );
                    }
                  }}
                />
              </Form.Item>
              <Form.Item
                label="SMTP 用户名"
                name="username"
                rules={[{ required: true, message: "请输入 SMTP 用户名" }]}
              >
                <Input autoComplete="username" placeholder="mail@example.com" />
              </Form.Item>
              <Form.Item
                label="SMTP 密码 / 授权码"
                name="password"
                rules={
                  canPreservePassword
                    ? []
                    : [
                        {
                          required: true,
                          message: "首次配置必须填写密码或授权码",
                        },
                      ]
                }
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder={
                    canPreservePassword
                      ? "已保存，留空不修改"
                      : "请输入密码或授权码"
                  }
                />
              </Form.Item>
              <Form.Item
                label="发件人邮箱"
                name="fromEmail"
                rules={[
                  { required: true, message: "请输入发件人邮箱" },
                  { type: "email", message: "请输入有效邮箱" },
                ]}
              >
                <Input autoComplete="email" placeholder="noreply@example.com" />
              </Form.Item>
              <Form.Item
                label="发件人名称"
                name="fromName"
                rules={[{ required: true, message: "请输入发件人名称" }]}
              >
                <Input autoComplete="organization" placeholder="AI Canvas" />
              </Form.Item>
            </div>
            <div className="smtp-form-actions">
              {settings?.state === "active" && settings.source === "managed" ? (
                <Button
                  danger
                  icon={<CircleStop size={16} />}
                  loading={busy === "disable"}
                  disabled={busy !== null && busy !== "disable"}
                  onClick={disable}
                >
                  停用
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="primary"
                icon={<Save size={16} />}
                loading={busy === "save"}
                disabled={
                  (!dirty && settings?.state !== "disabled") ||
                  (busy !== null && busy !== "save")
                }
                onClick={() => void save()}
              >
                保存并启用
              </Button>
            </div>
          </Form>
        )}
      </section>

      <section className="surface-section smtp-test-section">
        <div className="section-heading">
          <div className="section-heading__icon smtp-test-section__icon">
            <MailCheck size={18} />
          </div>
          <div>
            <h2>发送测试邮件</h2>
            <p>使用当前表单内容验证完整投递链路</p>
          </div>
        </div>
        <Form
          form={testForm}
          className="smtp-test-form"
          layout="vertical"
          requiredMark={false}
          onFinish={() => void sendTestEmail()}
        >
          <Form.Item
            label="收件人邮箱"
            name="recipient"
            rules={[
              { required: true, message: "请输入收件人邮箱" },
              { type: "email", message: "请输入有效邮箱" },
            ]}
          >
            <Input autoComplete="email" placeholder="test@example.com" />
          </Form.Item>
          <Button
            htmlType="submit"
            icon={<Send size={16} />}
            loading={busy === "email"}
            disabled={loading || (busy !== null && busy !== "email")}
          >
            发送测试邮件
          </Button>
        </Form>
      </section>
    </section>
  );
}
