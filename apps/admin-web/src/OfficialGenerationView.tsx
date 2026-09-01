import { useCallback, useEffect, useState } from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminCreditSettings,
  AdminOfficialModel,
  AdminOfficialProviderSummary,
  AdminRedemptionBatch,
  OfficialProviderProtocol,
} from "@ai-canvas-cloud/contracts";
import {
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
} from "antd";
import {
  Download,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { adminApi, AdminApiError } from "./api";
import { AccessDenied, Feedback, PageHeader } from "./components";
import { formatDateTime } from "./uiModel";

function message(error: unknown) {
  return error instanceof AdminApiError
    ? error.message
    : "请求未完成，请稍后重试";
}

export function OfficialGenerationView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "official-generation",
    action: "official_generation.write",
  });
  const [providers, setProviders] = useState<AdminOfficialProviderSummary[]>(
    [],
  );
  const [models, setModels] = useState<AdminOfficialModel[]>([]);
  const [settings, setSettings] = useState<AdminCreditSettings | null>(null);
  const [batches, setBatches] = useState<AdminRedemptionBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modelOptions, setModelOptions] = useState<
    { id: string; name: string | null }[]
  >([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [providerDraft, setProviderDraft] = useState({
    displayName: "",
    protocol: "openai-compatible" as OfficialProviderProtocol,
    baseUrl: "",
    apiKey: "",
  });
  const [modelDraft, setModelDraft] = useState({
    providerRevisionId: "",
    publicName: "",
    upstreamModelId: "",
    generate: true,
    edit: false,
    references: false,
    price1K: 1,
    price2K: 1,
    price4K: 1,
  });
  const [signupBonus, setSignupBonus] = useState(0);
  const [batchDraft, setBatchDraft] = useState({
    creditAmount: 100,
    codeCount: 10,
    expiresAt: "",
    note: "",
  });

  const load = useCallback(async () => {
    if (!access?.can) return;
    setLoading(true);
    setError(null);
    try {
      const [providerPage, modelPage, creditSettings, batchPage] =
        await Promise.all([
          adminApi.officialProviders(),
          adminApi.officialModels(),
          adminApi.creditSettings(),
          adminApi.redemptionBatches(),
        ]);
      setProviders(providerPage.items);
      setModels(modelPage.items);
      setSettings(creditSettings);
      setSignupBonus(creditSettings.signupBonus);
      setBatches(batchPage.items);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  }, [access?.can]);

  useEffect(() => void load(), [load]);

  async function createProvider() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.createOfficialProvider(providerDraft);
      setProviderOpen(false);
      setProviderDraft({
        displayName: "",
        protocol: "openai-compatible",
        baseUrl: "",
        apiKey: "",
      });
      setNotice("Provider 修订已创建，密钥不会再次展示");
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createModel() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.createOfficialModel({
        providerRevisionId: modelDraft.providerRevisionId,
        publicName: modelDraft.publicName,
        upstreamModelId: modelDraft.upstreamModelId,
        capabilities: {
          generate: modelDraft.generate,
          edit: modelDraft.edit,
          references: modelDraft.references,
        },
        prices: {
          "1K": modelDraft.price1K,
          "2K": modelDraft.price2K,
          "4K": modelDraft.price4K,
        },
        status: "active",
      });
      setModelOpen(false);
      setNotice("官方模型已创建");
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function discoverProviderModels() {
    if (!modelDraft.providerRevisionId) return;
    setModelsLoading(true);
    setError(null);
    try {
      const result = await adminApi.officialProviderModels(
        modelDraft.providerRevisionId,
      );
      setModelOptions(result.items);
      if (result.items.length === 0)
        setNotice("Provider 未返回可用模型，请手动填写模型 ID");
      else setNotice(`已获取 ${result.items.length} 个模型`);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setModelsLoading(false);
    }
  }

  async function toggleModel(model: AdminOfficialModel, active: boolean) {
    setBusy(true);
    try {
      await adminApi.updateOfficialModel(model.id, {
        providerRevisionId: model.providerRevisionId,
        publicName: model.name,
        upstreamModelId: model.upstreamModelId,
        capabilities: model.capabilities,
        prices: model.prices,
        status: active ? "active" : "disabled",
      });
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveSignupBonus() {
    setBusy(true);
    try {
      const next = await adminApi.updateCreditSettings({ signupBonus });
      setSettings(next);
      setNotice("新用户注册赠送规则已更新");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createBatch() {
    setBusy(true);
    try {
      const created = await adminApi.createRedemptionBatch({
        creditAmount: batchDraft.creditAmount,
        codeCount: batchDraft.codeCount,
        expiresAt: batchDraft.expiresAt
          ? new Date(batchDraft.expiresAt).toISOString()
          : null,
        note: batchDraft.note.trim() || null,
      });
      setCodes(created.codes);
      setNotice("兑换码已生成，请立即下载；关闭后无法再次查看明文");
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function downloadCodes() {
    if (!codes) return;
    const url = URL.createObjectURL(
      new Blob([`${codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai-canvas-redemption-codes-${Date.now()}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!accessLoading && access && !access.can) {
    return <AccessDenied message="当前角色无权管理官方模型与积分" />;
  }

  return (
    <section className="admin-page">
      <PageHeader
        title="官方模型与积分"
        description="管理受控 Provider、模型定价、注册赠送与单次兑换码"
        extra={
          <Button icon={<RefreshCw size={16} />} onClick={() => void load()}>
            刷新
          </Button>
        }
      />
      <Feedback error={error} success={notice} />
      {loading ? (
        <div className="surface-section">
          <Skeleton active paragraph={{ rows: 10 }} />
        </div>
      ) : (
        <Tabs
          items={[
            {
              key: "models",
              label: "Provider 与模型",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <section className="surface-section">
                    <PageHeader
                      title="Provider 修订"
                      description="凭据按不可变修订加密保存"
                      extra={
                        <Button
                          type="primary"
                          icon={<Plus size={16} />}
                          onClick={() => setProviderOpen(true)}
                        >
                          新建 Provider
                        </Button>
                      }
                    />
                    <Table
                      rowKey="id"
                      pagination={false}
                      dataSource={providers}
                      columns={[
                        { title: "名称", dataIndex: "displayName" },
                        { title: "协议", dataIndex: "protocol" },
                        {
                          title: "Endpoint",
                          dataIndex: "baseUrl",
                          ellipsis: true,
                        },
                        {
                          title: "创建时间",
                          dataIndex: "createdAt",
                          render: formatDateTime,
                        },
                        {
                          title: "操作",
                          render: (_, item) => (
                            <Button
                              icon={<PlugZap size={15} />}
                              onClick={() =>
                                void adminApi
                                  .testOfficialProvider(item.id)
                                  .then(() =>
                                    setNotice("Endpoint 与网络边界检查通过"),
                                  )
                                  .catch((cause) => setError(message(cause)))
                              }
                            >
                              连接测试
                            </Button>
                          ),
                        },
                      ]}
                    />
                  </section>
                  <section className="surface-section">
                    <PageHeader
                      title="官方模型"
                      description="价格按提交时快照结算"
                      extra={
                        <Button
                          type="primary"
                          icon={<Plus size={16} />}
                          disabled={!providers.length}
                          onClick={() => {
                            setModelDraft((value) => ({
                              ...value,
                              providerRevisionId:
                                value.providerRevisionId || providers[0]!.id,
                            }));
                            setModelOpen(true);
                          }}
                        >
                          新建模型
                        </Button>
                      }
                    />
                    <Table
                      rowKey="id"
                      pagination={false}
                      dataSource={models}
                      columns={[
                        { title: "公开名称", dataIndex: "name" },
                        { title: "Provider", dataIndex: "providerName" },
                        { title: "上游模型 ID", dataIndex: "upstreamModelId" },
                        {
                          title: "1K / 2K / 4K",
                          render: (_, item) =>
                            `${item.prices["1K"] ?? "-"} / ${item.prices["2K"] ?? "-"} / ${item.prices["4K"] ?? "-"}`,
                        },
                        {
                          title: "启用",
                          render: (_, item) => (
                            <Switch
                              checked={item.status === "active"}
                              loading={busy}
                              onChange={(checked) =>
                                void toggleModel(item, checked)
                              }
                            />
                          ),
                        },
                      ]}
                    />
                  </section>
                </Space>
              ),
            },
            {
              key: "credits",
              label: "积分规则",
              children: (
                <section className="surface-section">
                  <PageHeader
                    title="新用户注册赠送"
                    description={
                      settings?.signupBonusEnabledAt
                        ? `启用时间 ${formatDateTime(settings.signupBonusEnabledAt)}`
                        : "当前未启用；存量用户不会补发"
                    }
                  />
                  <Space align="end">
                    <Form.Item label="赠送积分">
                      <InputNumber
                        min={0}
                        max={1_000_000}
                        value={signupBonus}
                        onChange={(value) => setSignupBonus(value ?? 0)}
                      />
                    </Form.Item>
                    <Form.Item>
                      <Button
                        type="primary"
                        icon={<Save size={16} />}
                        loading={busy}
                        onClick={() => void saveSignupBonus()}
                      >
                        保存规则
                      </Button>
                    </Form.Item>
                  </Space>
                </section>
              ),
            },
            {
              key: "codes",
              label: "兑换码",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <section className="surface-section">
                    <PageHeader
                      title="生成兑换码"
                      description="单码单次，明文仅本次展示"
                    />
                    <Space wrap align="end">
                      <Form.Item label="每码积分">
                        <InputNumber
                          min={1}
                          max={1_000_000}
                          value={batchDraft.creditAmount}
                          onChange={(value) =>
                            setBatchDraft((draft) => ({
                              ...draft,
                              creditAmount: value ?? 1,
                            }))
                          }
                        />
                      </Form.Item>
                      <Form.Item label="数量">
                        <InputNumber
                          min={1}
                          max={10_000}
                          value={batchDraft.codeCount}
                          onChange={(value) =>
                            setBatchDraft((draft) => ({
                              ...draft,
                              codeCount: value ?? 1,
                            }))
                          }
                        />
                      </Form.Item>
                      <Form.Item label="过期时间">
                        <Input
                          type="datetime-local"
                          value={batchDraft.expiresAt}
                          onChange={(event) =>
                            setBatchDraft((draft) => ({
                              ...draft,
                              expiresAt: event.target.value,
                            }))
                          }
                        />
                      </Form.Item>
                      <Form.Item label="备注">
                        <Input
                          value={batchDraft.note}
                          onChange={(event) =>
                            setBatchDraft((draft) => ({
                              ...draft,
                              note: event.target.value,
                            }))
                          }
                        />
                      </Form.Item>
                      <Form.Item>
                        <Button
                          type="primary"
                          icon={<ShieldCheck size={16} />}
                          loading={busy}
                          onClick={() => void createBatch()}
                        >
                          生成
                        </Button>
                      </Form.Item>
                    </Space>
                  </section>
                  <section className="surface-section">
                    <Table
                      rowKey="id"
                      pagination={false}
                      dataSource={batches}
                      columns={[
                        { title: "积分", dataIndex: "creditAmount" },
                        {
                          title: "兑换进度",
                          render: (_, item) =>
                            `${item.redeemedCount} / ${item.codeCount}`,
                        },
                        {
                          title: "过期时间",
                          dataIndex: "expiresAt",
                          render: (value) =>
                            value ? formatDateTime(value) : "永不过期",
                        },
                        {
                          title: "状态",
                          dataIndex: "status",
                          render: (value) => (
                            <Tag
                              color={value === "active" ? "green" : "default"}
                            >
                              {value === "active" ? "有效" : "已作废"}
                            </Tag>
                          ),
                        },
                        {
                          title: "操作",
                          render: (_, item) => (
                            <Button
                              danger
                              disabled={item.status !== "active"}
                              onClick={() =>
                                void adminApi
                                  .revokeRedemptionBatch(item.id)
                                  .then(load)
                                  .catch((cause) => setError(message(cause)))
                              }
                            >
                              作废未兑换码
                            </Button>
                          ),
                        },
                      ]}
                    />
                  </section>
                </Space>
              ),
            },
          ]}
        />
      )}

      <Modal
        title="新建 Provider 修订"
        open={providerOpen}
        confirmLoading={busy}
        okText="创建"
        onOk={() => void createProvider()}
        onCancel={() => setProviderOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="显示名称">
            <Input
              value={providerDraft.displayName}
              onChange={(event) =>
                setProviderDraft((draft) => ({
                  ...draft,
                  displayName: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="协议">
            <Select
              value={providerDraft.protocol}
              options={[
                { value: "openai-compatible", label: "OpenAI Compatible" },
                { value: "dashscope", label: "DashScope" },
              ]}
              onChange={(protocol) =>
                setProviderDraft((draft) => ({ ...draft, protocol }))
              }
            />
          </Form.Item>
          <Form.Item label="HTTPS Endpoint">
            <Input
              value={providerDraft.baseUrl}
              onChange={(event) =>
                setProviderDraft((draft) => ({
                  ...draft,
                  baseUrl: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="API Key" extra="保存后不再展示明文">
            <Input.Password
              value={providerDraft.apiKey}
              onChange={(event) =>
                setProviderDraft((draft) => ({
                  ...draft,
                  apiKey: event.target.value,
                }))
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新建官方模型"
        open={modelOpen}
        confirmLoading={busy}
        okText="创建"
        onOk={() => void createModel()}
        onCancel={() => setModelOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="Provider">
            <Select
              value={modelDraft.providerRevisionId}
              options={providers.map((item) => ({
                value: item.id,
                label: item.displayName,
              }))}
              onChange={(providerRevisionId) => (
                setModelOptions([]),
                setModelDraft((draft) => ({
                  ...draft,
                  providerRevisionId,
                  upstreamModelId: "",
                }))
              )}
            />
          </Form.Item>
          <Form.Item label="公开名称">
            <Input
              value={modelDraft.publicName}
              onChange={(event) =>
                setModelDraft((draft) => ({
                  ...draft,
                  publicName: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item
            label="上游模型 ID"
            extra="可从 Provider 获取列表，也可以手动填写"
          >
            <Space.Compact style={{ width: "100%" }}>
              <Select
                showSearch
                value={modelDraft.upstreamModelId || undefined}
                placeholder="选择或输入模型 ID"
                options={modelOptions.map((item) => ({
                  value: item.id,
                  label: item.name ? `${item.name} (${item.id})` : item.id,
                }))}
                onChange={(upstreamModelId) =>
                  setModelDraft((draft) => ({ ...draft, upstreamModelId }))
                }
                onSearch={(upstreamModelId) =>
                  setModelDraft((draft) => ({ ...draft, upstreamModelId }))
                }
                filterOption={(input, option) =>
                  String(option?.label ?? "")
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                style={{ flex: 1 }}
              />
              <Button
                loading={modelsLoading}
                onClick={() => void discoverProviderModels()}
                disabled={!modelDraft.providerRevisionId}
              >
                获取模型
              </Button>
            </Space.Compact>
            {/* Keep a plain input fallback for providers that do not expose a catalog. */}
            <Input
              style={{ marginTop: 8 }}
              value={modelDraft.upstreamModelId}
              onChange={(event) =>
                setModelDraft((draft) => ({
                  ...draft,
                  upstreamModelId: event.target.value,
                }))
              }
            />
          </Form.Item>
          <Form.Item label="能力">
            <Space>
              <Checkbox
                checked={modelDraft.generate}
                onChange={(event) =>
                  setModelDraft((draft) => ({
                    ...draft,
                    generate: event.target.checked,
                  }))
                }
              >
                文生图
              </Checkbox>
              <Checkbox
                checked={modelDraft.edit}
                onChange={(event) =>
                  setModelDraft((draft) => ({
                    ...draft,
                    edit: event.target.checked,
                  }))
                }
              >
                图片编辑
              </Checkbox>
              <Checkbox
                checked={modelDraft.references}
                onChange={(event) =>
                  setModelDraft((draft) => ({
                    ...draft,
                    references: event.target.checked,
                  }))
                }
              >
                多参考图
              </Checkbox>
            </Space>
          </Form.Item>
          <Space>
            <Form.Item label="1K 积分">
              <InputNumber
                min={1}
                value={modelDraft.price1K}
                onChange={(value) =>
                  setModelDraft((draft) => ({ ...draft, price1K: value ?? 1 }))
                }
              />
            </Form.Item>
            <Form.Item label="2K 积分">
              <InputNumber
                min={1}
                value={modelDraft.price2K}
                onChange={(value) =>
                  setModelDraft((draft) => ({ ...draft, price2K: value ?? 1 }))
                }
              />
            </Form.Item>
            <Form.Item label="4K 积分">
              <InputNumber
                min={1}
                value={modelDraft.price4K}
                onChange={(value) =>
                  setModelDraft((draft) => ({ ...draft, price4K: value ?? 1 }))
                }
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title="兑换码明文"
        open={Boolean(codes)}
        okText="关闭"
        cancelButtonProps={{ style: { display: "none" } }}
        onOk={() => setCodes(null)}
        onCancel={() => setCodes(null)}
        footer={(_, { OkBtn }) => (
          <Space>
            <Button icon={<Download size={16} />} onClick={downloadCodes}>
              下载 TXT
            </Button>
            <OkBtn />
          </Space>
        )}
      >
        <Input.TextArea
          value={codes?.join("\n") ?? ""}
          readOnly
          autoSize={{ minRows: 8, maxRows: 16 }}
        />
      </Modal>
    </section>
  );
}
