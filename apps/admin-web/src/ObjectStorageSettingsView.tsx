import { useEffect, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  ObjectStorageSettingsInput,
  ObjectStorageSettingsResponse,
} from "@ai-canvas-cloud/contracts";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Skeleton,
  Space,
  Switch,
  Tag,
} from "antd";
import { DatabaseZap, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { AccessDenied, Feedback, PageHeader } from "./components";

interface FormFields {
  endpoint: string;
  publicEndpoint: string;
  publicOrigin: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

type BusyAction = "test" | "save" | "restore" | null;

const ERROR_MESSAGES: Record<string, string> = {
  OBJECT_STORAGE_CONFIG_CONFLICT: "对象存储配置已被更新，请刷新后重试。",
  OBJECT_STORAGE_IDENTITY_LOCKED:
    "当前已有资产，不能切换 Endpoint、Region、Bucket 或路径样式。",
  OBJECT_STORAGE_CONNECTION_FAILED:
    "读写删除测试失败，请检查 OSS 地址、Bucket、RAM 权限和跨域设置。",
  OBJECT_STORAGE_RATE_LIMITED: "测试操作过于频繁，请稍后再试。",
};

function errorMessage(error: unknown) {
  if (error instanceof AdminApiError) {
    return ERROR_MESSAGES[error.code] ?? error.message;
  }
  return "对象存储请求未完成，请稍后重试。";
}

function isFormValidationError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "errorFields" in error &&
    Array.isArray(error.errorFields),
  );
}

function formValues(settings: ObjectStorageSettingsResponse): FormFields {
  return {
    endpoint: settings.endpoint,
    publicEndpoint: settings.publicEndpoint,
    publicOrigin: settings.publicOrigin,
    region: settings.region,
    bucket: settings.bucket,
    forcePathStyle: settings.forcePathStyle,
  };
}

export function ObjectStorageSettingsView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "object-storage-settings",
    action: "object_storage_config.write",
  });
  const [form] = Form.useForm<FormFields>();
  const [settings, setSettings] =
    useState<ObjectStorageSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!access?.can) return;
    let active = true;
    void adminApi
      .objectStorageSettings()
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
  }, [access?.can, form]);

  useEffect(() => {
    if (settings && !loading) form.setFieldsValue(formValues(settings));
  }, [form, loading, settings]);

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  async function currentInput(): Promise<ObjectStorageSettingsInput> {
    const values = await form.validateFields();
    const accessKeyId = values.accessKeyId?.trim();
    const secretAccessKey = values.secretAccessKey?.trim();
    return {
      endpoint: values.endpoint,
      publicEndpoint: values.publicEndpoint,
      publicOrigin: values.publicOrigin,
      region: values.region,
      bucket: values.bucket,
      forcePathStyle: values.forcePathStyle,
      ...(accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : {}),
      expectedRevisionId: settings?.revisionId ?? null,
    };
  }

  async function testConnection() {
    setBusy("test");
    clearFeedback();
    try {
      await adminApi.testObjectStorageConnection(await currentInput());
      setNotice("OSS 连接及读写删除测试成功。");
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
      const updated = await adminApi.publishObjectStorageSettings(
        await currentInput(),
      );
      setSettings(updated);
      form.setFieldsValue({
        ...formValues(updated),
        accessKeyId: undefined,
        secretAccessKey: undefined,
      });
      setDirty(false);
      setNotice("对象存储配置已验证并发布。后端将在数秒内切换。");
    } catch (cause) {
      if (!isFormValidationError(cause)) setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  function restoreEnvironment() {
    if (!settings?.revisionId) return;
    Modal.confirm({
      title: "恢复环境配置？",
      content: "将撤销后台托管配置，并立即恢复容器环境变量中的 OSS 设置。",
      okText: "确认恢复",
      cancelText: "取消",
      async onOk() {
        setBusy("restore");
        clearFeedback();
        try {
          const updated = await adminApi.restoreEnvironmentObjectStorage({
            expectedRevisionId: settings.revisionId!,
          });
          setSettings(updated);
          form.setFieldsValue(formValues(updated));
          setDirty(false);
          setNotice("已恢复使用容器环境变量中的对象存储配置。 ");
        } catch (cause) {
          setError(errorMessage(cause));
        } finally {
          setBusy(null);
        }
      },
    });
  }

  if (accessLoading) return <Skeleton active paragraph={{ rows: 9 }} />;
  if (!access?.can)
    return <AccessDenied message="当前管理员无权配置对象存储" />;

  const managed = settings?.source === "managed";
  const needsCredentials = !managed;
  const identityLocked = Boolean(settings?.identityLocked);

  return (
    <section className="admin-page object-storage-settings-page">
      <PageHeader
        title="对象存储"
        description="管理画布图片、视频和迁移包使用的私有 OSS 存储"
        extra={
          <Space size={8} wrap>
            <Tag color={managed ? "success" : "processing"}>
              {managed ? "后台托管" : "环境配置"}
            </Tag>
            <Button
              icon={<DatabaseZap size={16} />}
              loading={busy === "test"}
              disabled={loading || (busy !== null && busy !== "test")}
              onClick={() => void testConnection()}
            >
              测试连接
            </Button>
          </Space>
        }
      />
      <Feedback error={error} success={notice} />
      {identityLocked ? (
        <Alert
          className="storage-lock-alert"
          type="warning"
          showIcon
          message="存储身份已锁定"
          description="当前已有资产。为防止历史文件失联，只能轮换 RAM AccessKey 或修改外部访问地址。"
        />
      ) : null}

      <section className="surface-section storage-config-section">
        <div className="section-heading">
          <div className="section-heading__icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <h2>OSS 连接配置</h2>
            <p>凭据加密保存且不会回显</p>
          </div>
        </div>
        {loading ? (
          <Skeleton active paragraph={{ rows: 7 }} />
        ) : (
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onValuesChange={() => setDirty(true)}
          >
            <div className="storage-form-grid">
              <Form.Item
                className="storage-form-grid__wide"
                label="OSS Endpoint"
                name="endpoint"
                rules={[
                  {
                    required: true,
                    type: "url",
                    message: "请输入有效的 Endpoint",
                  },
                ]}
              >
                <Input
                  disabled={identityLocked}
                  autoComplete="off"
                  placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                />
              </Form.Item>
              <Form.Item
                label="Region"
                name="region"
                rules={[{ required: true, message: "请输入 Region" }]}
              >
                <Input
                  disabled={identityLocked}
                  autoComplete="off"
                  placeholder="cn-hangzhou"
                />
              </Form.Item>
              <Form.Item
                label="Bucket"
                name="bucket"
                rules={[{ required: true, message: "请输入 Bucket" }]}
              >
                <Input
                  disabled={identityLocked}
                  autoComplete="off"
                  placeholder="ai-canvas-assets"
                />
              </Form.Item>
              <Form.Item
                className="storage-form-grid__wide"
                label="签名访问 Endpoint"
                name="publicEndpoint"
                rules={[
                  {
                    required: true,
                    type: "url",
                    message: "请输入有效的访问 Endpoint",
                  },
                ]}
              >
                <Input
                  autoComplete="off"
                  placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                />
              </Form.Item>
              <Form.Item
                className="storage-form-grid__wide"
                label="浏览器访问 Origin"
                name="publicOrigin"
                rules={[
                  {
                    required: true,
                    type: "url",
                    message: "请输入有效的 HTTPS Origin",
                  },
                ]}
              >
                <Input
                  autoComplete="off"
                  placeholder="https://bucket.oss-cn-hangzhou.aliyuncs.com"
                />
              </Form.Item>
              <Form.Item
                label="AccessKey ID"
                name="accessKeyId"
                rules={
                  needsCredentials
                    ? [
                        {
                          required: true,
                          message: "首次托管必须填写 AccessKey ID",
                        },
                      ]
                    : []
                }
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder={
                    managed ? "已保存，留空不修改" : "请输入 RAM AccessKey ID"
                  }
                />
              </Form.Item>
              <Form.Item
                label="AccessKey Secret"
                name="secretAccessKey"
                rules={
                  needsCredentials
                    ? [
                        {
                          required: true,
                          message: "首次托管必须填写 AccessKey Secret",
                        },
                      ]
                    : []
                }
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder={
                    managed
                      ? "已保存，留空不修改"
                      : "请输入 RAM AccessKey Secret"
                  }
                />
              </Form.Item>
              <Form.Item
                className="storage-switch-field"
                label="路径样式"
                name="forcePathStyle"
                valuePropName="checked"
              >
                <Switch
                  disabled={identityLocked}
                  checkedChildren="Path"
                  unCheckedChildren="Virtual Host"
                />
              </Form.Item>
            </div>
            <div className="storage-form-actions">
              {managed ? (
                <Button
                  icon={<RotateCcw size={16} />}
                  loading={busy === "restore"}
                  disabled={busy !== null && busy !== "restore"}
                  onClick={restoreEnvironment}
                >
                  恢复环境配置
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="primary"
                icon={<Save size={16} />}
                loading={busy === "save"}
                disabled={!dirty || (busy !== null && busy !== "save")}
                onClick={() => void save()}
              >
                保存并启用
              </Button>
            </div>
          </Form>
        )}
      </section>
    </section>
  );
}
