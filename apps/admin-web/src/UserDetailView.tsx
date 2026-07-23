import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useCan } from '@refinedev/core'
import type { AdminUserResponse } from '@ai-canvas-cloud/contracts'
import { ArrowLeft, Ban, Database, HardDrive, LoaderCircle, LogOut, RefreshCw, ShieldCheck, Unlock, UserRound, X } from 'lucide-react'
import { adminApi, AdminApiError } from './api'

function formatBytes(value: number) {
  const formatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
  if (value < 1024) return `${formatter.format(value)} B`
  if (value < 1024 ** 2) return `${formatter.format(value / 1024)} KiB`
  if (value < 1024 ** 3) return `${formatter.format(value / 1024 ** 2)} MiB`
  return `${formatter.format(value / 1024 ** 3)} GiB`
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}

export function UserDetailView({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { data: access, isLoading: accessLoading } = useCan({ resource: 'users', action: 'user.read' })
  const { data: writeAccess } = useCan({ resource: 'users', action: 'user.write' })
  const [detail, setDetail] = useState<AdminUserResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'ban' | 'unban' | 'revoke-sessions' | null>(null)
  const [reason, setReason] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  const load = useCallback(async () => {
    if (!access?.can) return
    setLoading(true)
    setError(null)
    try { setDetail(await adminApi.user(userId)) }
    catch (cause) { setError(cause instanceof AdminApiError ? cause.message : '用户详情加载失败，请稍后重试') }
    finally { setLoading(false) }
  }, [access?.can, userId])

  useEffect(() => { void load() }, [load])

  async function submitAction(event: FormEvent) {
    event.preventDefault()
    if (!pendingAction || reason.trim().length < 3) return
    setActionBusy(true)
    setError(null)
    setNotice(null)
    try {
      const input = { reason: reason.trim() }
      const result = pendingAction === 'ban'
        ? await adminApi.banUser(userId, input)
        : pendingAction === 'unban'
          ? await adminApi.unbanUser(userId, input)
          : await adminApi.revokeUserSessions(userId, input)
      setNotice(pendingAction === 'ban'
        ? `账号已封禁，撤销 ${result.revokedSessionCount} 个 session`
        : pendingAction === 'unban'
          ? '账号已解封，用户需重新登录'
          : `已撤销 ${result.revokedSessionCount} 个 session`)
      setPendingAction(null)
      setReason('')
      await load()
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : '用户操作失败，请稍后重试')
    } finally {
      setActionBusy(false)
    }
  }

  if (accessLoading) return <div className="empty-state"><LoaderCircle className="spin" />正在核对权限</div>
  if (!access?.can) return <div className="empty-state">当前角色无权读取用户运营摘要。</div>

  return (
    <section className="workspace-view user-detail-view">
      <div className="view-heading detail-heading">
        <div className="detail-title"><button className="icon-command" type="button" onClick={onBack} title="返回用户列表"><ArrowLeft /></button><div><span>ACCOUNT DETAIL / READ ONLY</span><h1>用户详情</h1></div></div>
        <button className="icon-command" type="button" onClick={() => void load()} disabled={loading} title="刷新用户详情"><RefreshCw className={loading ? 'spin' : ''} /></button>
      </div>
      {error ? <div className="error-notice" role="alert">{error}</div> : null}
      {notice ? <div className="success-notice"><ShieldCheck />{notice}</div> : null}
      {!detail && loading ? <div className="empty-state"><LoaderCircle className="spin" />正在加载运营摘要</div> : null}
      {detail ? (
        <>
          <div className="detail-profile">
            <div className="detail-avatar"><UserRound /></div>
            <div><span>NO. {detail.user.userNumber}</span><h2>{detail.user.name}</h2><p>{detail.user.email}</p><code>{detail.user.id}</code></div>
            <div className="detail-badges"><span className={`user-status ${detail.user.status}`}>{detail.user.status === 'active' ? '正常' : detail.user.status === 'disabled' ? '已封禁' : '已删除'}</span><span className={detail.user.emailVerified ? 'verification verified' : 'verification'}>{detail.user.emailVerified ? '邮箱已验证' : '邮箱未验证'}</span></div>
          </div>

          {writeAccess?.can && detail.user.status !== 'deleted' ? (
            <div className="user-actions-band">
              <div><span>CONTROLLED ACTIONS</span><strong>所有操作必须填写原因，并写入不可修改审计。</strong></div>
              <div>
                {detail.user.status === 'disabled'
                  ? <button type="button" onClick={() => setPendingAction('unban')}><Unlock />解封账号</button>
                  : <button className="danger" type="button" onClick={() => setPendingAction('ban')}><Ban />封禁账号</button>}
                <button type="button" onClick={() => setPendingAction('revoke-sessions')}><LogOut />撤销 session</button>
              </div>
            </div>
          ) : null}

          <div className="detail-metrics">
            <article><Database /><span>工作区</span><strong>{detail.user.workspaceCount}</strong><small>仅工作区摘要</small></article>
            <article><HardDrive /><span>已用存储</span><strong>{formatBytes(detail.user.storageUsedBytes)}</strong><small>不读取资产内容</small></article>
            <article><ShieldCheck /><span>有效 session</span><strong>{detail.user.activeSessionCount}</strong><small>不返回设备与 token</small></article>
            <article><UserRound /><span>最近活动</span><strong>{date(detail.user.lastActiveAt)}</strong><small>注册于 {date(detail.user.createdAt)}</small></article>
          </div>

          <div className="detail-section-heading"><div><span>WORKSPACE SUMMARY</span><h2>工作区与存储</h2></div><p>不包含项目列表、节点、Prompt 或资产记录。</p></div>
          <div className="workspace-summary-grid">
            {detail.workspaces.map((workspace) => (
              <article key={workspace.id}>
                <div className="workspace-summary-title"><div><span>{workspace.type}</span><h3>{workspace.name}</h3></div><em>{workspace.role}</em></div>
                <dl><div><dt>状态</dt><dd>{workspace.status}</dd></div><div><dt>套餐</dt><dd>{workspace.planKey}</dd></div><div><dt>已用</dt><dd>{formatBytes(workspace.storageUsedBytes)}</dd></div><div><dt>预留</dt><dd>{formatBytes(workspace.storageReservedBytes)}</dd></div><div><dt>配额</dt><dd>{formatBytes(workspace.storageQuotaBytes)}</dd></div><div><dt>更新</dt><dd>{date(workspace.updatedAt)}</dd></div></dl>
                <code>{workspace.id}</code>
              </article>
            ))}
            {detail.workspaces.length === 0 ? <div className="empty-state">没有可展示的非删除工作区</div> : null}
          </div>
        </>
      ) : null}
      {pendingAction ? (
        <div className="action-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !actionBusy) setPendingAction(null) }}>
          <form className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="user-action-title" onSubmit={submitAction}>
            <div className="action-dialog-heading"><div><span>REASON REQUIRED</span><h2 id="user-action-title">{pendingAction === 'ban' ? '封禁账号' : pendingAction === 'unban' ? '解封账号' : '撤销全部 session'}</h2></div><button className="icon-command" type="button" onClick={() => setPendingAction(null)} disabled={actionBusy} title="关闭"><X /></button></div>
            <p>{pendingAction === 'ban' ? '封禁会立即撤销全部 session，后续登录将被拒绝。' : pendingAction === 'unban' ? '解封不会恢复旧 session，用户需要重新登录。' : '撤销后用户在所有设备都需要重新登录。'}</p>
            <label><span>处理原因</span><textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} placeholder="请填写 3–500 字符的运营原因" required /></label>
            <small>{reason.trim().length} / 500</small>
            <div className="action-dialog-footer"><button type="button" onClick={() => setPendingAction(null)} disabled={actionBusy}>取消</button><button className={pendingAction === 'ban' ? 'danger' : ''} type="submit" disabled={actionBusy || reason.trim().length < 3}>{actionBusy ? <LoaderCircle className="spin" /> : <ShieldCheck />}确认执行</button></div>
          </form>
        </div>
      ) : null}
    </section>
  )
}
