import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useCan } from "@refinedev/core";
import type {
  AdminDashboardResponse,
  AdminDependencyHealth,
  GenerationFailureCategory,
} from "@ai-canvas-cloud/contracts";
import {
  Button,
  Empty,
  Progress,
  Skeleton,
  Table,
  Tag,
  Tooltip,
  type TableColumnsType,
} from "antd";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Database,
  Gauge,
  HardDrive,
  RefreshCw,
  Sparkles,
  Timer,
  TriangleAlert,
  UserPlus,
  UsersRound,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { adminApi, AdminApiError } from "./api";
import { AccessDenied, Feedback, PageHeader } from "./components";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "./uiModel";

const FAILURE_LABELS: Record<GenerationFailureCategory, string> = {
  network: "网络与连接",
  authentication: "服务商鉴权",
  rate_limited: "限流或配额",
  upstream: "上游服务异常",
  invalid_response: "响应格式异常",
  asset_upload: "资产保存失败",
  unknown: "其他异常",
};

const HEALTH_ERROR_LABELS: Record<
  NonNullable<AdminDependencyHealth["error"]>,
  string
> = {
  connection_refused: "连接被拒绝",
  timeout: "连接超时",
  authentication_failed: "认证失败",
  permission_denied: "权限不足",
  bucket_unavailable: "存储桶不可用",
  unknown: "未知异常",
};

interface HealthTableRow {
  key: string;
  name: string;
  detail: string;
  latencyMs: number;
  ok: boolean;
}

const HEALTH_COLUMNS: TableColumnsType<HealthTableRow> = [
  {
    title: "依赖项",
    dataIndex: "name",
    key: "name",
    render: (name: string, row) => (
      <div className="health-table__service">
        <strong>{name}</strong>
        <span>{row.detail}</span>
      </div>
    ),
  },
  {
    title: "响应时间",
    dataIndex: "latencyMs",
    key: "latencyMs",
    width: 104,
    align: "right",
    render: (latencyMs: number) => (
      <span className="health-table__latency">{latencyMs} ms</span>
    ),
  },
  {
    title: "状态",
    dataIndex: "ok",
    key: "ok",
    width: 78,
    align: "center",
    render: (ok: boolean) => (
      <Tag color={ok ? "success" : "error"}>{ok ? "健康" : "异常"}</Tag>
    ),
  },
];

function KpiCard({
  icon,
  label,
  value,
  unit,
  comparison,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
  comparison: string;
  detail: string;
  tone: "blue" | "green" | "teal" | "amber" | "gray";
}) {
  return (
    <article className={`kpi-card kpi-card--${tone}`}>
      <header>
        <span className="kpi-card__icon">{icon}</span>
        <span className="kpi-card__scope">今日</span>
      </header>
      <div className="kpi-card__label">{label}</div>
      <div className="kpi-card__value">
        <strong>{value}</strong>
        <span>{unit}</span>
      </div>
      <div className="kpi-card__comparison">{comparison}</div>
      <p>{detail}</p>
    </article>
  );
}

function compareCount(current: number, previous: number) {
  const difference = current - previous;
  if (difference === 0) return "与昨日同期持平";
  return `较昨日同期 ${difference > 0 ? "+" : ""}${formatNumber(difference)}`;
}

function compareRate(current: number, previous: number) {
  const difference = current - previous;
  if (Math.abs(difference) < 0.05) return "与昨日同期持平";
  return `较昨日同期 ${difference > 0 ? "+" : ""}${difference.toFixed(1)} 个百分点`;
}

function formatDuration(value: number | null) {
  if (value === null) return "暂无数据";
  if (value < 1_000) return `${formatNumber(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} 秒`;
  return `${(value / 60_000).toFixed(1)} 分钟`;
}

function healthDetail(value: AdminDependencyHealth) {
  return value.error ? HEALTH_ERROR_LABELS[value.error] : "连接与权限检查正常";
}

function hasGenerationSummary(value: AdminDashboardResponse) {
  const generation = (value as Partial<AdminDashboardResponse>).generation;
  return Boolean(
    generation?.today &&
    generation.yesterdaySamePeriod &&
    Array.isArray(generation.daily) &&
    Array.isArray(generation.failures),
  );
}

export function DashboardView() {
  const { data: access, isLoading: accessLoading } = useCan({
    resource: "dashboard",
    action: "dashboard.read",
  });
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!access?.can) return;
    setLoading(true);
    setError(null);
    try {
      const nextDashboard = await adminApi.dashboard();
      if (!hasGenerationSummary(nextDashboard)) {
        throw new Error("Administrator dashboard response is incomplete");
      }
      setDashboard(nextDashboard);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError
          ? cause.message
          : "运营概览加载失败，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  }, [access?.can]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!accessLoading && access && !access.can)
    return <AccessDenied message="当前角色无权读取运营聚合" />;

  const storagePercent = dashboard?.storage.quotaBytes
    ? Math.min(
        100,
        (dashboard.storage.usedBytes / dashboard.storage.quotaBytes) * 100,
      )
    : 0;
  const today = dashboard?.generation?.today;
  const yesterday = dashboard?.generation?.yesterdaySamePeriod;
  const trendData =
    dashboard?.generation?.daily.map((item) => ({
      ...item,
      label: item.date.slice(5).replace("-", "/"),
      total: item.text + item.image + item.video,
    })) ?? [];
  const trendTotal = trendData.reduce((total, item) => total + item.total, 0);
  const terminalCount = today
    ? today.succeeded + today.failed + today.canceled
    : 0;
  const qualityData = today
    ? [
        {
          label: "成功",
          value: today.succeeded,
          tone: "success",
        },
        { label: "失败", value: today.failed, tone: "danger" },
        { label: "取消", value: today.canceled, tone: "muted" },
        {
          label: "进行中",
          value: Math.max(0, today.requests - terminalCount),
          tone: "active",
        },
      ]
    : [];
  const failureData =
    dashboard?.generation?.failures.map((item) => ({
      name: FAILURE_LABELS[item.category],
      value: item.count,
    })) ?? [];

  const healthData: HealthTableRow[] = dashboard
    ? [
        {
          key: "postgres",
          name: "PostgreSQL",
          detail: healthDetail(dashboard.infrastructure.postgres),
          latencyMs: dashboard.infrastructure.postgres.latencyMs,
          ok: dashboard.infrastructure.postgres.ok,
        },
        {
          key: "object-storage",
          name: "对象存储",
          detail: healthDetail(dashboard.infrastructure.objectStorage),
          latencyMs: dashboard.infrastructure.objectStorage.latencyMs,
          ok: dashboard.infrastructure.objectStorage.ok,
        },
      ]
    : [];

  return (
    <section className="admin-page dashboard-page">
      <PageHeader
        title="运营概览"
        description={
          dashboard
            ? `上海时间自然日 · 更新于 ${formatDateTime(dashboard.generatedAt)}`
            : "查看 AI 生成、用户、存储与基础设施状态"
        }
        extra={
          <Tooltip title="刷新运营概览">
            <Button
              icon={<RefreshCw size={17} />}
              loading={loading}
              onClick={() => void load()}
              aria-label="刷新运营概览"
            />
          </Tooltip>
        }
      />
      <Feedback error={error} />

      {!dashboard || !today || !yesterday ? (
        <div className="surface-section">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      ) : (
        <>
          <section className="dashboard-kpis" aria-label="今日核心运营指标">
            <KpiCard
              icon={<Sparkles size={18} />}
              label="AI 请求"
              value={formatNumber(today.requests)}
              unit="次"
              comparison={compareCount(today.requests, yesterday.requests)}
              detail={`${formatNumber(terminalCount)} 次已进入终态`}
              tone="blue"
            />
            <KpiCard
              icon={<BadgeCheck size={18} />}
              label="完成生成"
              value={formatNumber(today.results)}
              unit="个结果"
              comparison={compareCount(today.results, yesterday.results)}
              detail={`${formatNumber(today.succeeded)} 次请求成功`}
              tone="green"
            />
            <KpiCard
              icon={<Gauge size={18} />}
              label="生成成功率"
              value={formatPercent(today.successRate, 1)}
              unit=""
              comparison={compareRate(today.successRate, yesterday.successRate)}
              detail="主动取消不计入成功率分母"
              tone="teal"
            />
            <KpiCard
              icon={<UsersRound size={18} />}
              label="活跃创作者"
              value={formatNumber(today.activeCreators)}
              unit="人"
              comparison={compareCount(
                today.activeCreators,
                yesterday.activeCreators,
              )}
              detail="今天至少发起过一次生成"
              tone="amber"
            />
            <KpiCard
              icon={<UserPlus size={18} />}
              label="新增用户"
              value={formatNumber(dashboard.registrations.today)}
              unit="人"
              comparison={compareCount(
                dashboard.registrations.today,
                dashboard.registrations.yesterdaySamePeriod,
              )}
              detail={`累计 ${formatNumber(dashboard.registrations.total)} 位用户`}
              tone="gray"
            />
          </section>

          <div className="generation-overview-grid">
            <section className="surface-section generation-trend-panel">
              <div className="section-heading section-heading--split">
                <div className="section-heading__main">
                  <div className="section-heading__icon">
                    <BarChart3 size={18} />
                  </div>
                  <div>
                    <h2>近 7 日生成趋势</h2>
                    <p>按请求发起日期统计文本、图片与视频调用</p>
                  </div>
                </div>
                <Tag>{formatNumber(trendTotal)} 次请求</Tag>
              </div>

              {trendTotal === 0 ? (
                <div className="dashboard-chart-empty">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="近 7 日暂无生成请求"
                  />
                </div>
              ) : (
                <div
                  className="generation-trend-chart"
                  role="img"
                  aria-label={`近 7 日共 ${formatNumber(trendTotal)} 次生成请求，其中今天 ${formatNumber(today.requests)} 次`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={trendData}
                      margin={{ top: 18, right: 12, bottom: 0, left: -18 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="#e8edf3"
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#6f7b8d", fontSize: 12 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#8893a3", fontSize: 11 }}
                      />
                      <RechartsTooltip
                        cursor={{ fill: "#f5f7fa" }}
                        formatter={(value, name) => [
                          `${formatNumber(Number(value))} 次`,
                          String(name),
                        ]}
                        labelFormatter={(label) => `日期 ${String(label)}`}
                        contentStyle={{
                          border: "1px solid #dfe5ed",
                          borderRadius: 7,
                          boxShadow: "0 8px 22px rgba(24, 32, 47, 0.08)",
                        }}
                      />
                      <Legend iconType="square" iconSize={8} />
                      <Bar
                        dataKey="text"
                        name="文本"
                        stackId="requests"
                        fill="#426b9b"
                        maxBarSize={34}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="image"
                        name="图片"
                        stackId="requests"
                        fill="#16846f"
                        maxBarSize={34}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="video"
                        name="视频"
                        stackId="requests"
                        fill="#c17b2d"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={34}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        name="总请求"
                        stroke="#253044"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={{ r: 3, fill: "#ffffff", strokeWidth: 2 }}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

              <details className="chart-data-table">
                <summary>查看 7 日数据明细</summary>
                <div>
                  <table>
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>文本</th>
                        <th>图片</th>
                        <th>视频</th>
                        <th>成功</th>
                        <th>失败</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendData.map((item) => (
                        <tr key={item.date}>
                          <td>{item.date}</td>
                          <td>{formatNumber(item.text)}</td>
                          <td>{formatNumber(item.image)}</td>
                          <td>{formatNumber(item.video)}</td>
                          <td>{formatNumber(item.succeeded)}</td>
                          <td>{formatNumber(item.failed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>

            <section className="surface-section generation-quality-panel">
              <div className="section-heading">
                <div className="section-heading__icon">
                  <Activity size={18} />
                </div>
                <div>
                  <h2>今日运行质量</h2>
                  <p>请求终态与用户感知耗时</p>
                </div>
              </div>
              <div className="quality-summary">
                <div>
                  <span>成功率</span>
                  <strong>{formatPercent(today.successRate, 1)}</strong>
                </div>
                <div>
                  <span>P95 完成耗时</span>
                  <strong>{formatDuration(today.p95DurationMs)}</strong>
                </div>
              </div>
              <div className="quality-bars">
                {qualityData.map((item) => (
                  <div className="quality-row" key={item.label}>
                    <div>
                      <span>{item.label}</span>
                      <strong>{formatNumber(item.value)}</strong>
                    </div>
                    <div
                      className="quality-row__track"
                      role="progressbar"
                      aria-label={`${item.label}请求`}
                      aria-valuemin={0}
                      aria-valuemax={Math.max(1, today.requests)}
                      aria-valuenow={item.value}
                    >
                      <i
                        className={`quality-row__fill quality-row__fill--${item.tone}`}
                        style={{
                          width: `${today.requests > 0 ? (item.value / today.requests) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="quality-note">
                <Timer size={15} />
                <span>耗时仅统计已成功或失败的请求</span>
              </div>
            </section>
          </div>

          <section className="surface-section failure-panel">
            <div className="section-heading section-heading--split">
              <div className="section-heading__main">
                <div className="section-heading__icon section-heading__icon--warning">
                  <TriangleAlert size={18} />
                </div>
                <div>
                  <h2>今日失败原因</h2>
                  <p>仅保留脱敏分类，不采集上游错误正文</p>
                </div>
              </div>
              <Tag color={today.failed > 0 ? "warning" : "default"}>
                {formatNumber(today.failed)} 次失败
              </Tag>
            </div>
            {failureData.length === 0 ? (
              <div className="failure-empty">
                <BadgeCheck size={19} />
                <div>
                  <strong>今天暂无失败请求</strong>
                  <span>失败分类将在出现异常后显示</span>
                </div>
              </div>
            ) : (
              <div
                className="failure-chart"
                role="img"
                aria-label={failureData
                  .map((item) => `${item.name} ${formatNumber(item.value)} 次`)
                  .join("，")}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={failureData}
                    layout="vertical"
                    margin={{ top: 4, right: 46, bottom: 2, left: 8 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      stroke="#edf0f4"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#8893a3", fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={92}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#566277", fontSize: 12 }}
                    />
                    <RechartsTooltip
                      cursor={{ fill: "#faf7f2" }}
                      formatter={(value) => [
                        `${formatNumber(Number(value))} 次`,
                        "失败请求",
                      ]}
                    />
                    <Bar
                      dataKey="value"
                      fill="#b96e2d"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={24}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="value"
                        position="right"
                        fill="#364152"
                        fontSize={12}
                        fontWeight={600}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="operations-grid">
            <section className="surface-section">
              <div className="section-heading">
                <div className="section-heading__icon">
                  <HardDrive size={18} />
                </div>
                <div>
                  <h2>存储聚合</h2>
                  <p>私有对象存储用量与工作区配额</p>
                </div>
              </div>
              <div className="storage-summary">
                <div>
                  <strong>{formatBytes(dashboard.storage.usedBytes)}</strong>
                  <span>
                    已用，共 {formatBytes(dashboard.storage.quotaBytes)}
                  </span>
                </div>
                <Progress
                  percent={Number(storagePercent.toFixed(2))}
                  strokeColor="#426b9b"
                  trailColor="#e8edf4"
                  format={() => formatPercent(storagePercent)}
                />
              </div>
              <dl className="inline-stats">
                <div>
                  <dt>预留</dt>
                  <dd>{formatBytes(dashboard.storage.reservedBytes)}</dd>
                </div>
                <div>
                  <dt>计费资产</dt>
                  <dd>{formatNumber(dashboard.storage.assetCount)}</dd>
                </div>
                <div>
                  <dt>配额使用率</dt>
                  <dd>{formatPercent(storagePercent)}</dd>
                </div>
              </dl>
            </section>

            <section className="surface-section">
              <div className="section-heading">
                <div className="section-heading__icon">
                  <Database size={18} />
                </div>
                <div>
                  <h2>依赖健康</h2>
                  <p>Admin API 关键基础设施探测结果</p>
                </div>
              </div>
              <Table<HealthTableRow>
                className="health-table"
                columns={HEALTH_COLUMNS}
                dataSource={healthData}
                pagination={false}
                size="small"
                tableLayout="fixed"
              />
            </section>
          </div>
        </>
      )}
    </section>
  );
}
