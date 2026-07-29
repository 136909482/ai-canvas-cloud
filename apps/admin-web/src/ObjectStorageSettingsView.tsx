import { useEffect, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  AssetCleanupSummary,
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
import {
  DatabaseZap,
  HardDrive,
  RotateCcw,
  Save,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { AccessDenied, Feedback, PageHeader } from "./components";
import { formatBytes } from "./uiModel";

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

type BusyAction =
  "test" | "save" | "restore" | "cleanup-preview" | "cleanup-apply" | null;

const ERROR_MESSAGES: Record<string, string> = {
  OBJECT_STORAGE_CONFIG_CONFLICT: "对象存储配置已被更新，请刷新后重试。",
  OBJECT_STORAGE_IDENTITY_LOCKED:
    "当前已有资产，不能切换 Endpoint、Region、Bucket 或路径样式。",
  OBJECT_STORAGE_ENVIRONMENT_FALLBACK_UNAVAILABLE:
    "当前安装没有设置环境回退，请继续使用后台托管配置。",
  OBJECT_STORAGE_CONNECTION_FAILED:
    "读写删除测试失败，请检查 OSS 地址、Bucket、RAM 权限和跨域设置。",
  OBJECT_STORAGE_RATE_LIMITED: "测试操作过于频繁，请稍后再试。",
  ASSET_CLEANUP_FAILED: "资产清理服务暂时不可用，请稍后重试。",
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
  const [cleanupSummary, setCleanupSummary] =
    useState<AssetCleanupSummary | null>(null);

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

  async function previewCleanup() {
    setBusy("cleanup-preview");
    clearFeedback();
    try {
      const summary = await adminApi.previewAssetCleanup();
      setCleanupSummary(summary);
      setNotice(
        summary.reclaimableObjectCount > 0
          ? `扫描完成：发现 ${summary.reclaimableObjectCount} 个可清理文件。`
          : "扫描完成：当前没有达到清理条件的文件。",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  function applyCleanup() {
    if (
      cleanupSummary?.mode !== "preview" ||
      !cleanupSummary.reclaimableObjectCount
    )
      return;
    Modal.confirm({
      title: "清理无引用文件？",
      content: `将永久删除 ${cleanupSummary.reclaimableObjectCount} 个 OSS 文件，预计释放 ${formatBytes(cleanupSummary.reclaimableBytes)}。此操作不可撤销。`,
      okText: "确认清理",
      cancelText: "取消",
      okButtonProps: { danger: true },
      async onOk() {
        setBusy("cleanup-apply");
        clearFeedback();
        try {
          const summary = await adminApi.applyAssetCleanup();
          setCleanupSummary(summary);
          setNotice(
            `清理完成：删除 ${summary.deletedObjectCount} 个文件，释放 ${formatBytes(summary.deletedBytes)}。`,
          );
        } catch (cause) {
          setError(errorMessage(cause));
          throw cause;
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
  const unconfigured = settings?.source === "unconfigured";
  const needsCredentials = !managed;
  const identityLocked = Boolean(settings?.identityLocked);

  return (
    <section className="admin-page object-storage-settings-page">
      <PageHeader
        title="对象存储"
        description="管理画布图片、视频和迁移包使用的私有 OSS 存储"
        extra={
          <Space size={8} wrap>
            <Tag
              color={
                managed ? "success" : unconfigured ? "warning" : "processing"
              }
            >
              {managed ? "后台托管" : unconfigured ? "尚未配置" : "环境配置"}
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
      {unconfigured ? (
        <Alert
          className="storage-lock-alert"
          type="info"
          showIcon
          message="对象存储尚未配置"
          description="请填写 OSS 连接信息并保存启用；在此之前，图片和视频上传功能不可用。"
        />
      ) : null}
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
              {managed && settings?.environmentFallbackConfigured ? (
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

      {!unconfigured ? (
        <section className="surface-section asset-cleanup-section">
          <div className="section-heading asset-cleanup-heading">
            <div className="section-heading__icon">
              <HardDrive size={18} />
            </div>
            <div>
              <h2>无引用资产清理</h2>
              <p>仅处理超过 7 天且未被当前画布或有效保存点引用的文件</p>
            </div>
          </div>

          <div className="asset-cleanup-summary" aria-live="polite">
            <div>
              <span>
                {cleanupSummary?.mode === "apply" ? "本次删除" : "可清理文件"}
              </span>
              <strong>
                {cleanupSummary
                  ? cleanupSummary.mode === "apply"
                    ? cleanupSummary.deletedObjectCount
                    : cleanupSummary.reclaimableObjectCount
                  : "--"}
              </strong>
            </div>
            <div>
              <span>
                {cleanupSummary?.mode === "apply" ? "已释放" : "预计释放"}
              </span>
              <strong>
                {cleanupSummary
                  ? formatBytes(
                      cleanupSummary.mode === "apply"
                        ? cleanupSummary.deletedBytes
                        : cleanupSummary.reclaimableBytes,
                    )
                  : "--"}
              </strong>
            </div>
            <div>
              <span>缺失对象记录</span>
              <strong>{cleanupSummary?.missingObjectCount ?? "--"}</strong>
            </div>
          </div>

          {cleanupSummary?.truncated ? (
            <Alert
              type="warning"
              showIcon
              message="本次扫描达到批次上限，请完成清理后再次扫描。"
            />
          ) : null}

          <div className="asset-cleanup-actions">
            <Button
              icon={<ScanSearch size={16} />}
              loading={busy === "cleanup-preview"}
              disabled={busy !== null && busy !== "cleanup-preview"}
              onClick={() => void previewCleanup()}
            >
              扫描可清理文件
            </Button>
            <Button
              danger
              icon={<Trash2 size={16} />}
              loading={busy === "cleanup-apply"}
              disabled={
                cleanupSummary?.mode !== "preview" ||
                !cleanupSummary.reclaimableObjectCount ||
                (busy !== null && busy !== "cleanup-apply")
              }
              onClick={applyCleanup}
            >
              立即清理
            </Button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
