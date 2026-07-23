import { useCallback, useEffect, useState } from 'react'
import { useCan } from '@refinedev/core'
import type { AdminDashboardResponse, AdminDependencyHealth } from '@ai-canvas-cloud/contracts'
import { Activity, Database, HardDrive, LoaderCircle, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react'
import { adminApi, AdminApiError } from './api'

function number(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function bytes(value: number) {
  if (value < 1024) return `${number(value)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  if (value < 1024 ** 4) return `${(value / 1024 ** 3).toFixed(2)} GiB`
  return `${(value / 1024 ** 4).toFixed(2)} TiB`
}

function Health({ name, value }: { name: string; value: AdminDependencyHealth }) {
  return <article className={`health-tile ${value.ok ? 'ok' : 'degraded'}`}><div><i /><span>{name}</span></div><strong>{value.ok ? 'HEALTHY' : 'DEGRADED'}</strong><small>{value.latencyMs} ms{value.error ? ` · ${value.error}` : ''}</small></article>
}

export function DashboardView() {
  const { data: access, isLoading: accessLoading } = useCan({ resource: 'dashboard', action: 'dashboard.read' })
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!access?.can) return
    setLoading(true)
    setError(null)
    try { setDashboard(await adminApi.dashboard()) }
    catch (cause) { setError(cause instanceof AdminApiError ? cause.message : '运营概览加载失败，请稍后重试') }
    finally { setLoading(false) }
  }, [access?.can])

  useEffect(() => { void load() }, [load])

  if (accessLoading) return <div className="empty-state"><LoaderCircle className="spin" />正在核对权限</div>
  if (!access?.can) return <div className="empty-state">当前角色无权读取运营聚合。</div>
  return (
    <section className="workspace-view dashboard-view">
      <div className="view-heading"><div><span>OPERATIONS PULSE / AGGREGATES ONLY</span><h1>运营概览</h1></div><button className="icon-command" type="button" onClick={() => void load()} disabled={loading} title="刷新运营概览"><RefreshCw className={loading ? 'spin' : ''} /></button></div>
      {error ? <div className="error-notice" role="alert">{error}</div> : null}
      {!dashboard && loading ? <div className="empty-state"><LoaderCircle className="spin" />正在聚合运营状态</div> : null}
      {dashboard ? (
        <>
          <div className="dashboard-pulse">
            <div><span>GENERATED AT</span><strong>{new Date(dashboard.generatedAt).toLocaleString('zh-CN', { hour12: false })}</strong></div>
            <p>这里只显示计数、用量和健康分类；不读取用户创作内容。</p>
          </div>
          <div className="dashboard-grid">
            <article className="dashboard-panel"><div className="panel-heading"><UsersRound /><div><span>REGISTRATION</span><h2>注册</h2></div></div><strong className="panel-primary">{number(dashboard.registrations.total)}</strong><dl><div><dt>24 小时新增</dt><dd>+{number(dashboard.registrations.past24Hours)}</dd></div><div><dt>7 天新增</dt><dd>+{number(dashboard.registrations.past7Days)}</dd></div></dl></article>
            <article className="dashboard-panel"><div className="panel-heading"><Activity /><div><span>ACTIVITY</span><h2>活跃</h2></div></div><strong className="panel-primary">{number(dashboard.activity.activeUsers24Hours)}</strong><dl><div><dt>7 天活跃用户</dt><dd>{number(dashboard.activity.activeUsers7Days)}</dd></div><div><dt>有效 session</dt><dd>{number(dashboard.activity.activeSessions)}</dd></div></dl></article>
            <article className="dashboard-panel"><div className="panel-heading"><ShieldCheck /><div><span>AUTHENTICATION</span><h2>认证安全</h2></div></div><strong className="panel-primary">{number(dashboard.authentication.verifiedUsers)}</strong><dl><div><dt>未验证</dt><dd>{number(dashboard.authentication.unverifiedUsers)}</dd></div><div><dt>已封禁</dt><dd>{number(dashboard.authentication.disabledUsers)}</dd></div></dl></article>
          </div>

          <div className="storage-panel">
            <div className="panel-heading"><HardDrive /><div><span>PRIVATE STORAGE</span><h2>存储聚合</h2></div></div>
            <div className="storage-numbers"><div><span>已用</span><strong>{bytes(dashboard.storage.usedBytes)}</strong></div><div><span>预留</span><strong>{bytes(dashboard.storage.reservedBytes)}</strong></div><div><span>总配额</span><strong>{bytes(dashboard.storage.quotaBytes)}</strong></div><div><span>计费资产</span><strong>{number(dashboard.storage.assetCount)}</strong></div></div>
            <div className="storage-track"><i style={{ width: `${dashboard.storage.quotaBytes > 0 ? Math.min(100, dashboard.storage.usedBytes / dashboard.storage.quotaBytes * 100) : 0}%` }} /></div>
          </div>

          <div className="infrastructure-panel"><div className="panel-heading"><Database /><div><span>ADMIN API DEPENDENCIES</span><h2>基础设施健康</h2></div></div><div className="health-grid"><Health name="PostgreSQL" value={dashboard.infrastructure.postgres} /><Health name="Object Storage" value={dashboard.infrastructure.objectStorage} /></div></div>
        </>
      ) : null}
    </section>
  )
}
