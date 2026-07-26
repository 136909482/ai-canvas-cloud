import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCan } from "@refinedev/core";
import type {
  SiteAssetKind,
  SiteAssetSummary,
  SiteConfigDocument,
  SiteThemePreset,
} from "@ai-canvas-cloud/contracts";
import { DEFAULT_SITE_CONFIG } from "@ai-canvas-cloud/contracts";
import {
  Button,
  Checkbox,
  Form,
  Input,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Tabs,
  Tooltip,
  Upload,
} from "antd";
import {
  Check,
  Image as ImageIcon,
  RotateCcw,
  Save,
  Upload as UploadIcon,
} from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { AccessDenied, Feedback, PageHeader } from "./components";
import { formatDateTime } from "./uiModel";

function errorMessage(error: unknown) {
  return error instanceof AdminApiError ? error.message : "网站设置请求未完成";
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength = 120,
  children,
}: {
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  children?: ReactNode;
}) {
  return (
    <Form.Item label={label}>
      {children ?? (
        <Input
          aria-label={label}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          showCount={maxLength <= 300}
        />
      )}
    </Form.Item>
  );
}

function NullableField({
  label,
  value,
  onChange,
  placeholder,
  maxLength = 2048,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <Field
      label={label}
      value={value ?? ""}
      onChange={(next) => onChange(next || null)}
      placeholder={placeholder}
      maxLength={maxLength}
    />
  );
}

function AssetSelector({
  kind,
  label,
  help,
  assets,
  selectedId,
  busy,
  onSelect,
  onUpload,
}: {
  kind: SiteAssetKind;
  label: string;
  help: string;
  assets: SiteAssetSummary[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onUpload: (kind: SiteAssetKind, file: File) => void;
}) {
  const candidates = assets.filter(
    (asset) => asset.kind === kind && asset.status === "completed",
  );
  const selected = candidates.find((asset) => asset.id === selectedId) ?? null;
  return (
    <section className="asset-row">
      <div className="asset-thumbnail">
        {selected?.url ? (
          <img src={selected.url} alt="" />
        ) : (
          <ImageIcon size={22} />
        )}
      </div>
      <div className="asset-row__description">
        <strong>{label}</strong>
        <span>
          {selected
            ? `${selected.width} x ${selected.height} · ${selected.mimeType}`
            : help}
        </span>
      </div>
      {candidates.length > 1 ? (
        <Select
          className="asset-select"
          aria-label={`选择${label}`}
          value={selectedId ?? ""}
          onChange={(value) => onSelect(value || null)}
          options={[
            { value: "", label: "内置资产" },
            ...candidates.map((asset) => ({
              value: asset.id,
              label: asset.originalFileName,
            })),
          ]}
        />
      ) : null}
      <Space size={6}>
        <Upload
          accept="image/png,image/jpeg,image/webp,image/x-icon,.ico"
          showUploadList={false}
          beforeUpload={(file) => {
            onUpload(kind, file);
            return Upload.LIST_IGNORE;
          }}
        >
          <Button loading={busy} icon={<UploadIcon size={16} />}>
            上传
          </Button>
        </Upload>
        {selected ? (
          <Tooltip title="恢复内置资产">
            <Button
              icon={<RotateCcw size={16} />}
              onClick={() => onSelect(null)}
              aria-label={`恢复内置${label}`}
            />
          </Tooltip>
        ) : null}
      </Space>
    </section>
  );
}

export function SiteConfigView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "site-config",
    action: "site_config.write",
  });
  const [config, setConfig] = useState<SiteConfigDocument>(() =>
    structuredClone(DEFAULT_SITE_CONFIG),
  );
  const [assets, setAssets] = useState<SiteAssetSummary[]>([]);
  const [note, setNote] = useState("");
  const [revision, setRevision] = useState<{
    id: string;
    createdAt: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<SiteAssetKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    if (accessLoading || !access?.can) {
      setLoading(accessLoading);
      return;
    }
    let active = true;
    Promise.all([adminApi.siteConfig(), adminApi.siteAssets()])
      .then(([site, assetPage]) => {
        if (!active) return;
        setConfig(structuredClone(site.config));
        setRevision(
          site.revision
            ? { id: site.revision.id, createdAt: site.revision.createdAt }
            : null,
        );
        setAssets(assetPage.items);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [access?.can, accessLoading]);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  const recordCount = useMemo(
    () => Object.values(config.records).filter(Boolean).length,
    [config.records],
  );

  async function upload(kind: SiteAssetKind, file: File) {
    setUploading(kind);
    setError(null);
    try {
      const result = await adminApi.uploadSiteAsset(kind, file);
      setAssets((current) => [
        result.asset,
        ...current.filter((asset) => asset.id !== result.asset.id),
      ]);
      setConfig((current) => ({
        ...current,
        [kind === "logo" ? "logoAssetId" : "faviconAssetId"]: result.asset.id,
      }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await adminApi.publishSiteConfig({
        config,
        note: note || null,
      });
      setConfig(structuredClone(result.config));
      setRevision(
        result.revision
          ? { id: result.revision.id, createdAt: result.revision.createdAt }
          : null,
      );
      setNote("");
      setSaved(true);
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (!accessLoading && access && !access.can)
    return <AccessDenied message="当前角色无权管理网站设置" />;

  const tabItems = [
    {
      key: "brand",
      label: "品牌",
      children: (
        <div className="tab-form-content">
          <div className="tab-intro">
            <h2>品牌资产</h2>
            <p>只接受服务端支持的 PNG、JPEG、WebP 或 ICO 文件。</p>
          </div>
          <div className="asset-list">
            <AssetSelector
              kind="logo"
              label="主 Logo"
              help="使用内置品牌资产"
              assets={assets}
              selectedId={config.logoAssetId}
              busy={uploading === "logo"}
              onSelect={(logoAssetId) =>
                setConfig((current) => ({ ...current, logoAssetId }))
              }
              onUpload={(kind, file) => void upload(kind, file)}
            />
            <AssetSelector
              kind="favicon"
              label="Favicon"
              help="使用内置站点图标"
              assets={assets}
              selectedId={config.faviconAssetId}
              busy={uploading === "favicon"}
              onSelect={(faviconAssetId) =>
                setConfig((current) => ({ ...current, faviconAssetId }))
              }
              onUpload={(kind, file) => void upload(kind, file)}
            />
          </div>
        </div>
      ),
    },
    {
      key: "site",
      label: "站点",
      children: (
        <div className="tab-form-content">
          <div className="tab-intro">
            <h2>站点与首页</h2>
            <p>发布后立即切换公开站点的当前修订。</p>
          </div>
          <div className="site-form-grid">
            <Field
              label="网站名称"
              value={config.siteName}
              maxLength={80}
              onChange={(siteName) =>
                setConfig((current) => ({ ...current, siteName }))
              }
            />
            <Field
              label="短名称"
              value={config.shortName}
              maxLength={32}
              onChange={(shortName) =>
                setConfig((current) => ({ ...current, shortName }))
              }
            />
            <Field
              label="首页标题"
              value={config.home.headline}
              maxLength={80}
              onChange={(headline) =>
                setConfig((current) => ({
                  ...current,
                  home: { ...current.home, headline },
                }))
              }
            />
            <Field
              label="首页主张"
              value={config.home.lead}
              maxLength={120}
              onChange={(lead) =>
                setConfig((current) => ({
                  ...current,
                  home: { ...current.home, lead },
                }))
              }
            />
            <div className="site-form-grid__wide">
              <Field label="首页描述">
                <Input.TextArea
                  aria-label="首页描述"
                  value={config.home.description}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      home: {
                        ...current.home,
                        description: event.target.value,
                      },
                    }))
                  }
                  maxLength={300}
                  showCount
                  rows={4}
                />
              </Field>
            </div>
            <Field
              label="主操作文字"
              value={config.home.primaryActionLabel}
              maxLength={40}
              onChange={(primaryActionLabel) =>
                setConfig((current) => ({
                  ...current,
                  home: { ...current.home, primaryActionLabel },
                }))
              }
            />
          </div>
        </div>
      ),
    },
    {
      key: "features",
      label: "主题与功能",
      children: (
        <div className="tab-form-content">
          <div className="tab-intro">
            <h2>主题与功能</h2>
            <p>这些选项只影响公开站点，不改变 Admin 固定浅色主题。</p>
          </div>
          <div className="control-stack">
            <div className="control-row">
              <div>
                <strong>主题预设</strong>
                <span>决定公开站点的默认外观</span>
              </div>
              <Segmented
                aria-label="公开站点主题预设"
                value={config.themePreset}
                options={[
                  { value: "system", label: "跟随系统" },
                  { value: "light", label: "浅色" },
                  { value: "dark", label: "深色" },
                ]}
                onChange={(themePreset) =>
                  setConfig((current) => ({
                    ...current,
                    themePreset: themePreset as SiteThemePreset,
                  }))
                }
              />
            </div>
            <div className="control-row control-row--top">
              <div>
                <strong>公开导航</strong>
                <span>至少保留一个顶级入口</span>
              </div>
              <Space wrap>
                {(
                  [
                    ["home", "产品"],
                    ["help", "支持"],
                    ["legal", "法律"],
                  ] as const
                ).map(([item, label]) => (
                  <Checkbox
                    key={item}
                    checked={config.navigation.includes(item)}
                    disabled={
                      config.navigation.includes(item) &&
                      config.navigation.length === 1
                    }
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        navigation: event.target.checked
                          ? [...current.navigation, item]
                          : current.navigation.filter(
                              (value) => value !== item,
                            ),
                      }))
                    }
                  >
                    {label}
                  </Checkbox>
                ))}
              </Space>
            </div>
            <div className="control-row">
              <div>
                <strong>允许注册</strong>
                <span>控制公开注册入口</span>
              </div>
              <Switch
                aria-label="允许注册"
                checked={config.features.registrationEnabled}
                onChange={(registrationEnabled) =>
                  setConfig((current) => ({
                    ...current,
                    features: { ...current.features, registrationEnabled },
                  }))
                }
              />
            </div>
            <div className="control-row">
              <div>
                <strong>反馈入口</strong>
                <span>控制公开站点反馈入口</span>
              </div>
              <Switch
                aria-label="反馈入口"
                checked={config.features.feedbackEnabled}
                onChange={(feedbackEnabled) =>
                  setConfig((current) => ({
                    ...current,
                    features: { ...current.features, feedbackEnabled },
                  }))
                }
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "links",
      label: "链接",
      children: (
        <div className="tab-form-content">
          <div className="tab-intro">
            <h2>公开链接</h2>
            <p>仅允许无凭据、无 fragment 的绝对 HTTP(S) 地址。</p>
          </div>
          <div className="site-form-grid">
            <NullableField
              label="帮助中心"
              value={config.links.helpUrl}
              onChange={(helpUrl) =>
                setConfig((current) => ({
                  ...current,
                  links: { ...current.links, helpUrl },
                }))
              }
              placeholder="https://"
            />
            <NullableField
              label="问题反馈"
              value={config.links.feedbackUrl}
              onChange={(feedbackUrl) =>
                setConfig((current) => ({
                  ...current,
                  links: { ...current.links, feedbackUrl },
                }))
              }
              placeholder="https://"
            />
            <NullableField
              label="用户协议"
              value={config.links.termsUrl}
              onChange={(termsUrl) =>
                setConfig((current) => ({
                  ...current,
                  links: { ...current.links, termsUrl },
                }))
              }
              placeholder="https://"
            />
            <NullableField
              label="隐私政策"
              value={config.links.privacyUrl}
              onChange={(privacyUrl) =>
                setConfig((current) => ({
                  ...current,
                  links: { ...current.links, privacyUrl },
                }))
              }
              placeholder="https://"
            />
            <NullableField
              label="账号注销说明"
              value={config.links.accountDeletionUrl}
              onChange={(accountDeletionUrl) =>
                setConfig((current) => ({
                  ...current,
                  links: { ...current.links, accountDeletionUrl },
                }))
              }
              placeholder="https://"
            />
          </div>
        </div>
      ),
    },
    {
      key: "footer",
      label: "页脚与备案",
      children: (
        <div className="tab-form-content">
          <div className="tab-intro">
            <h2>页脚与备案</h2>
            <p>已填写 {recordCount} 项主体或备案信息。</p>
          </div>
          <div className="site-form-grid">
            <Field
              label="页脚描述"
              value={config.footer.description}
              maxLength={160}
              onChange={(description) =>
                setConfig((current) => ({
                  ...current,
                  footer: { ...current.footer, description },
                }))
              }
            />
            <Field
              label="版权文字"
              value={config.footer.copyright}
              maxLength={120}
              onChange={(copyright) =>
                setConfig((current) => ({
                  ...current,
                  footer: { ...current.footer, copyright },
                }))
              }
            />
            <NullableField
              label="企业主体"
              value={config.records.companyName}
              onChange={(companyName) =>
                setConfig((current) => ({
                  ...current,
                  records: { ...current.records, companyName },
                }))
              }
              maxLength={120}
            />
            <NullableField
              label="ICP备案"
              value={config.records.icpNumber}
              onChange={(icpNumber) =>
                setConfig((current) => ({
                  ...current,
                  records: { ...current.records, icpNumber },
                }))
              }
              maxLength={120}
            />
            <NullableField
              label="公安备案"
              value={config.records.publicSecurityNumber}
              onChange={(publicSecurityNumber) =>
                setConfig((current) => ({
                  ...current,
                  records: { ...current.records, publicSecurityNumber },
                }))
              }
              maxLength={120}
            />
            <Field
              label="修订备注"
              value={note}
              maxLength={500}
              placeholder="本次调整原因"
              onChange={setNote}
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <section className="admin-page site-config-page">
      <div className="sticky-page-header">
        <PageHeader
          title="网站设置"
          description={
            revision
              ? `当前修订发布于 ${formatDateTime(revision.createdAt)}`
              : "尚未创建发布修订"
          }
          extra={
            <Button
              type="primary"
              icon={saved ? <Check size={16} /> : <Save size={16} />}
              loading={saving}
              disabled={loading}
              onClick={() => void save()}
            >
              {saved ? "已发布" : "发布修订"}
            </Button>
          }
        />
      </div>
      <Feedback error={error} success={saved ? "网站设置已发布" : null} />
      {loading ? (
        <div className="surface-section">
          <Skeleton active paragraph={{ rows: 9 }} />
        </div>
      ) : (
        <Form component="div" layout="vertical" requiredMark={false}>
          <section className="settings-tabs">
            <Tabs items={tabItems} destroyOnHidden={false} />
          </section>
        </Form>
      )}
    </section>
  );
}
