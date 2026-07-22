import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useCan, useList } from '@refinedev/core'
import type { AdminLoginResponse, AdminSessionResponse } from '@ai-canvas-cloud/contracts'
import {
  Activity,
  ArrowRight,
  Check,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import { adminApi, AdminApiError } from './api'
import { setAdminIdentity, type AuditRecord } from './refine'
import { SiteConfigView } from './SiteConfigView'

type Flow = 'loading' | 'login' | 'app'
type View = 'security' | 'site' | 'audit'

function errorMessage(error: unknown) {
  return error instanceof AdminApiError ? error.message : '请求未完成，请稍后重试'
}

function Brand() {
  return (
    <div className="brand-lockup">
      <img src="/brand/ai-canvas-mark.png" alt="" />
      <div><strong>AI Canvas</strong><span>ADMIN CONTROL</span></div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function ErrorNotice({ message }: { message: string | null }) {
  return message ? <div className="error-notice" role="alert"><X size={16} />{message}</div> : null
}

function LoginScreen({ onComplete }: { onComplete: (response: AdminLoginResponse) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captcha, setCaptcha] = useState<Awaited<ReturnType<typeof adminApi.captcha>> | null>(null)
  const [captchaCode, setCaptchaCode] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(true)
  const [captchaReady, setCaptchaReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refreshCaptcha() {
    setCaptchaLoading(true)
    setCaptchaCode('')
    try {
      setCaptcha(await adminApi.captcha())
      setCaptchaReady(true)
    } catch (cause) {
      setCaptcha(null)
      setCaptchaReady(false)
      setError(errorMessage(cause))
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => { void refreshCaptcha() }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onComplete(await adminApi.login(
        username,
        password,
        captcha?.enabled && captcha.challenge
          ? { challengeId: captcha.challenge.id, code: captchaCode }
          : undefined,
      ))
    }
    catch (cause) {
      setError(errorMessage(cause))
      await refreshCaptcha()
    }
    finally { setBusy(false); setPassword('') }
  }

  return (
    <main className="auth-shell">
      <section className="auth-signal">
        <Brand />
        <div className="signal-copy">
          <span className="signal-index">CONTROL PLANE / 01</span>
          <h1>运营控制台</h1>
          <p>隔离身份域 · 独立管理凭据</p>
        </div>
        <div className="signal-status"><span /><small>ADMIN ORIGIN</small><strong>ISOLATED</strong></div>
      </section>
      <section className="auth-workspace">
        <form className="auth-form" onSubmit={submit}>
          <div className="form-heading"><LockKeyhole size={24} /><div><h2>管理员登录</h2><p>使用独立管理员凭据继续</p></div></div>
          <ErrorNotice message={error} />
          <Field label="管理员账号"><input type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={30} required /></Field>
          <Field label="密码"><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
          {captcha?.enabled && captcha.challenge ? (
            <Field label="验证码">
              <div className="captcha-row">
                <input className="captcha-input" inputMode="numeric" autoComplete="off" value={captchaCode} onChange={(event) => setCaptchaCode(event.target.value.replace(/\D/g, '').slice(0, 5))} maxLength={5} aria-label="5 位图片验证码" required />
                <img className="captcha-image" src={captcha.challenge.imageDataUrl} alt="登录验证码" />
                <button className="captcha-refresh" type="button" onClick={() => void refreshCaptcha()} disabled={captchaLoading} title="刷新验证码" aria-label="刷新验证码"><RefreshCw className={captchaLoading ? 'spin' : ''} /></button>
              </div>
            </Field>
          ) : null}
          <button className="primary-command" type="submit" disabled={busy || captchaLoading || !captchaReady || (captcha?.enabled === true && captchaCode.length !== 5)}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}<span>继续</span>
          </button>
        </form>
      </section>
    </main>
  )
}

function AuditView() {
  const { data: access } = useCan({ resource: 'audit-events', action: 'audit.read' })
  const { result, query } = useList<AuditRecord>({ resource: 'audit-events', pagination: { currentPage: 1, pageSize: 50 } })
  if (access && !access.can) return <div className="empty-state">当前角色无权读取审计事件。</div>
  return (
    <section className="workspace-view">
      <div className="view-heading"><div><span>AUDIT TRAIL</span><h1>管理审计</h1></div><button className="icon-command" onClick={() => void query.refetch()} title="刷新审计事件"><RefreshCw className={query.isFetching ? 'spin' : ''} /></button></div>
      <div className="audit-table-wrap">
        <table className="audit-table"><thead><tr><th>时间</th><th>动作</th><th>管理员角色</th><th>目标</th><th>结果</th><th>请求 ID</th></tr></thead>
          <tbody>{result.data.map((event) => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}</td><td><code>{event.action}</code></td><td>{event.adminRole ?? 'system'}</td><td>{event.targetType ?? '—'}</td><td><span className={`result ${event.result}`}>{event.result}</span></td><td><code className="request-id">{event.requestId}</code></td></tr>)}</tbody>
        </table>
        {!query.isLoading && result.data.length === 0 ? <div className="empty-state">暂无审计事件</div> : null}
      </div>
    </section>
  )
}

function SecurityView({ session, onSessionUpdated }: { session: AdminSessionResponse; onSessionUpdated: (session: AdminSessionResponse) => void }) {
  const [username, setUsername] = useState(session.admin.username)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [captchaEnabled, setCaptchaEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<'username' | 'password' | 'captcha' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (session.admin.role !== 'super_admin') return
    let active = true
    void adminApi.loginSecuritySettings()
      .then((value) => { if (active) setCaptchaEnabled(value.captchaEnabled) })
      .catch((cause) => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [session.admin.role])
  const controls = useMemo(() => [
    ['身份域', '独立 Admin schema', 'ok'],
    ['登录验证', captchaEnabled === null ? '账号与密码' : captchaEnabled ? '图片验证码已开启' : '账号与密码', captchaEnabled ? 'ok' : 'neutral'],
    ['当前角色', session.admin.role, 'neutral'],
    ['会话到期', new Date(session.expiresAt).toLocaleString('zh-CN', { hour12: false }), 'neutral'],
  ], [captchaEnabled, session])
  async function toggleCaptcha(nextValue: boolean) {
    setBusy('captcha'); setError(null); setNotice(null)
    try {
      const updated = await adminApi.updateLoginSecuritySettings(nextValue)
      setCaptchaEnabled(updated.captchaEnabled)
      setNotice(updated.captchaEnabled ? '登录验证码已开启，下次登录时生效' : '登录验证码已关闭')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null) }
  }
  async function saveUsername(event: FormEvent) {
    event.preventDefault(); setBusy('username'); setError(null); setNotice(null)
    try {
      const updated = await adminApi.updateUsername({ username })
      setUsername(updated.admin.username); onSessionUpdated(updated); setNotice('管理员账号已更新')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null) }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null)
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return }
    setBusy('password')
    try {
      const updated = await adminApi.changePassword({ currentPassword, newPassword })
      onSessionUpdated(updated); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setNotice('密码已更新，其他管理会话已撤销')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null) }
  }
  return (
    <section className="workspace-view">
      <div className="view-heading"><div><span>SECURITY POSTURE</span><h1>安全状态</h1></div><div className="live-badge"><i />LIVE</div></div>
      <div className="posture-list">{controls.map(([label, value, state]) => <div className="posture-row" key={label}><span>{label}</span><strong>{value}</strong><i className={state} /></div>)}</div>
      <div className="scope-band"><ShieldCheck /><div><span>ACTIVE ADMIN</span><strong>{session.admin.username}</strong></div><code>{session.admin.id}</code></div>
      <ErrorNotice message={error} />
      {notice ? <div className="success-notice"><Check size={16} />{notice}</div> : null}
      <div className="credential-grid">
        {session.admin.role === 'super_admin' ? (
          <section className="credential-panel credential-panel--security">
            <div className="credential-panel__heading"><ShieldCheck /><div><h2>登录验证码</h2><p>开启后，管理员登录时需要输入页面展示的 5 位图片验证码。</p></div></div>
            <label className="security-toggle">
              <span><strong>要求图片验证码</strong><small>默认关闭，修改后对下一次登录生效</small></span>
              <input type="checkbox" checked={captchaEnabled ?? false} disabled={captchaEnabled === null || busy !== null} onChange={(event) => void toggleCaptcha(event.target.checked)} />
              <i />
            </label>
          </section>
        ) : null}
        <form className="credential-panel" onSubmit={saveUsername}>
          <div className="credential-panel__heading"><UserRound /><div><h2>管理员账号</h2><p>账号不使用邮箱，可随时修改。</p></div></div>
          <Field label="登录账号"><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" required /></Field>
          <button className="secondary-command" type="submit" disabled={busy !== null || username === session.admin.username}>{busy === 'username' ? <LoaderCircle className="spin" /> : <Check />}保存账号</button>
        </form>
        <form className="credential-panel" onSubmit={savePassword}>
          <div className="credential-panel__heading"><KeyRound /><div><h2>修改密码</h2><p>更新后保留当前会话并撤销其他会话。</p></div></div>
          <Field label="当前密码"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></Field>
          <Field label="新密码（至少 12 位）"><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required /></Field>
          <Field label="确认新密码"><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} required /></Field>
          <button className="secondary-command" type="submit" disabled={busy !== null}>{busy === 'password' ? <LoaderCircle className="spin" /> : <KeyRound />}更新密码</button>
        </form>
      </div>
    </section>
  )
}

function Console({ session, onSessionUpdated, onLogout }: { session: AdminSessionResponse; onSessionUpdated: (session: AdminSessionResponse) => void; onLogout: () => void }) {
  const [view, setView] = useState<View>('security')
  const [mobileNav, setMobileNav] = useState(false)
  return (
    <main className="console-shell">
      <aside className={mobileNav ? 'open' : ''}>
        <Brand />
        <nav><button className={view === 'security' ? 'active' : ''} onClick={() => { setView('security'); setMobileNav(false) }}><Activity />安全状态</button><button className={view === 'site' ? 'active' : ''} onClick={() => { setView('site'); setMobileNav(false) }}><Settings2 />网站设置</button><button className={view === 'audit' ? 'active' : ''} onClick={() => { setView('audit'); setMobileNav(false) }}><ScrollText />管理审计</button></nav>
        <footer><div><span>{session.admin.role}</span><strong>{session.admin.username}</strong></div><button className="icon-command" onClick={onLogout} title="退出管理端"><LogOut /></button></footer>
      </aside>
      <header className="mobile-header"><Brand /><button className="icon-command" onClick={() => setMobileNav((value) => !value)} title="打开导航"><Menu /></button></header>
      <div className="console-workspace">{view === 'security' ? <SecurityView session={session} onSessionUpdated={onSessionUpdated} /> : view === 'site' ? <SiteConfigView /> : <AuditView />}</div>
    </main>
  )
}

export function AdminApp() {
  const [flow, setFlow] = useState<Flow>('loading')
  const [session, setSession] = useState<AdminSessionResponse | null>(null)
  useEffect(() => {
    let active = true
    void adminApi.session().then((value) => {
      if (!active) return
      setSession(value); setAdminIdentity(value); setFlow('app')
    }).catch(() => { if (active) setFlow('login') })
    return () => { active = false }
  }, [])
  async function logout() { await adminApi.logout().catch(() => undefined); setSession(null); setAdminIdentity(null); setFlow('login') }
  function loginComplete(response: AdminLoginResponse) {
    setSession(response.session); setAdminIdentity(response.session); setFlow('app')
  }
  if (flow === 'loading') return <div className="loading-screen"><LoaderCircle className="spin" /><span>ADMIN CONTROL</span></div>
  if (flow === 'login') return <LoginScreen onComplete={loginComplete} />
  return session ? <Console session={session} onSessionUpdated={(value) => { setSession(value); setAdminIdentity(value) }} onLogout={() => void logout()} /> : <LoginScreen onComplete={loginComplete} />
}
