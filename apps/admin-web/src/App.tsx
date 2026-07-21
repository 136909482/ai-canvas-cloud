import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useCan, useList } from '@refinedev/core'
import type { AdminLoginResponse, AdminMfaSetupResponse, AdminSessionResponse } from '@ai-canvas-cloud/contracts'
import {
  Activity,
  ArrowRight,
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  X,
} from 'lucide-react'
import QRCode from 'qrcode'
import { adminApi, AdminApiError } from './api'
import { setAdminIdentity, type AuditRecord } from './refine'

type Flow = 'loading' | 'login' | 'mfa_challenge' | 'mfa_setup' | 'app'
type View = 'security' | 'audit'

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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try { onComplete(await adminApi.login(email, password)) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false); setPassword('') }
  }

  return (
    <main className="auth-shell">
      <section className="auth-signal">
        <Brand />
        <div className="signal-copy">
          <span className="signal-index">CONTROL PLANE / 01</span>
          <h1>运营控制台</h1>
          <p>隔离身份域 · 强制多因素认证</p>
        </div>
        <div className="signal-status"><span /><small>ADMIN ORIGIN</small><strong>ISOLATED</strong></div>
      </section>
      <section className="auth-workspace">
        <form className="auth-form" onSubmit={submit}>
          <div className="form-heading"><LockKeyhole size={24} /><div><h2>管理员登录</h2><p>使用独立管理员凭据继续</p></div></div>
          <ErrorNotice message={error} />
          <Field label="管理员邮箱"><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
          <Field label="密码"><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></Field>
          <button className="primary-command" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}<span>继续</span>
          </button>
        </form>
      </section>
    </main>
  )
}

function ChallengeScreen({ onVerified, onCancel }: { onVerified: (session: AdminSessionResponse) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { onVerified(mode === 'totp' ? await adminApi.verifyTotp(code) : await adminApi.verifyRecoveryCode(code)) }
    catch (cause) { setError(errorMessage(cause)); setCode('') }
    finally { setBusy(false) }
  }
  return (
    <main className="focused-auth">
      <Brand />
      <form className="challenge-panel" onSubmit={submit}>
        <div className="form-heading"><ShieldCheck size={24} /><div><h1>验证第二因素</h1><p>完成验证后建立管理会话</p></div></div>
        <div className="segmented" role="tablist">
          <button type="button" className={mode === 'totp' ? 'active' : ''} onClick={() => { setMode('totp'); setCode('') }}>动态口令</button>
          <button type="button" className={mode === 'recovery' ? 'active' : ''} onClick={() => { setMode('recovery'); setCode('') }}>恢复码</button>
        </div>
        <ErrorNotice message={error} />
        <Field label={mode === 'totp' ? '6 位动态口令' : '一次性恢复码'}>
          <input className="code-input" inputMode={mode === 'totp' ? 'numeric' : 'text'} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={mode === 'totp' ? 6 : 64} required autoFocus />
        </Field>
        <button className="primary-command" type="submit" disabled={busy}><Check size={18} /><span>验证</span></button>
        <button className="text-command" type="button" onClick={onCancel}>返回登录</button>
      </form>
    </main>
  )
}

function MfaSetupScreen({ onVerified, onCancel }: { onVerified: (session: AdminSessionResponse) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<AdminMfaSetupResponse | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (setup) void QRCode.toDataURL(setup.totpUri, { width: 220, margin: 1, color: { dark: '#111714', light: '#ffffff' } }).then((value) => { if (active) setQr(value) })
    return () => { active = false }
  }, [setup])

  async function begin(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { setSetup(await adminApi.setupTotp(password)); setPassword('') }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { onVerified(await adminApi.verifyTotp(code)) }
    catch (cause) { setError(errorMessage(cause)); setCode('') }
    finally { setBusy(false) }
  }
  async function copyCodes() {
    if (!setup) return
    await navigator.clipboard.writeText(setup.recoveryCodes.join('\n'))
    setCopied(true); window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main className="setup-shell">
      <header><Brand /><span>首次登录安全设置</span></header>
      {!setup ? (
        <form className="setup-intro" onSubmit={begin}>
          <span className="step-number">01</span><KeyRound size={28} />
          <h1>启用动态口令</h1><p>确认当前密码后生成 TOTP 密钥与一次性恢复码。</p>
          <ErrorNotice message={error} />
          <Field label="确认密码"><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></Field>
          <button className="primary-command" type="submit" disabled={busy}><ArrowRight size={18} /><span>生成安全设置</span></button>
          <button className="text-command" type="button" onClick={onCancel}>退出</button>
        </form>
      ) : (
        <form className="setup-grid" onSubmit={verify}>
          <section className="qr-zone"><span className="step-number">02</span>{qr ? <img src={qr} alt="TOTP 二维码" /> : <LoaderCircle className="spin" /> }<p>使用认证器扫描</p></section>
          <section className="recovery-zone">
            <div className="section-title"><div><span className="step-number">03</span><h2>保存恢复码</h2></div><button className="icon-command" type="button" onClick={() => void copyCodes()} title="复制恢复码">{copied ? <Check /> : <Clipboard />}</button></div>
            <div className="recovery-codes">{setup.recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
          </section>
          <section className="verify-zone"><span className="step-number">04</span><h2>确认动态口令</h2><ErrorNotice message={error} /><Field label="6 位动态口令"><input className="code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={6} required /></Field><button className="primary-command" type="submit" disabled={busy}><ShieldCheck size={18} /><span>完成启用</span></button></section>
        </form>
      )}
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

function SecurityView({ session }: { session: AdminSessionResponse }) {
  const controls = useMemo(() => [
    ['身份域', '独立 Admin schema', 'ok'],
    ['第二因素', session.admin.twoFactorEnabled ? 'TOTP 已启用' : '未启用', session.admin.twoFactorEnabled ? 'ok' : 'warn'],
    ['当前角色', session.admin.role, 'neutral'],
    ['会话到期', new Date(session.expiresAt).toLocaleString('zh-CN', { hour12: false }), 'neutral'],
  ], [session])
  return (
    <section className="workspace-view">
      <div className="view-heading"><div><span>SECURITY POSTURE</span><h1>安全状态</h1></div><div className="live-badge"><i />LIVE</div></div>
      <div className="posture-list">{controls.map(([label, value, state]) => <div className="posture-row" key={label}><span>{label}</span><strong>{value}</strong><i className={state} /></div>)}</div>
      <div className="scope-band"><ShieldCheck /><div><span>ACTIVE ADMIN</span><strong>{session.admin.email}</strong></div><code>{session.admin.id}</code></div>
    </section>
  )
}

function Console({ session, onLogout }: { session: AdminSessionResponse; onLogout: () => void }) {
  const [view, setView] = useState<View>('security')
  const [mobileNav, setMobileNav] = useState(false)
  return (
    <main className="console-shell">
      <aside className={mobileNav ? 'open' : ''}>
        <Brand />
        <nav><button className={view === 'security' ? 'active' : ''} onClick={() => { setView('security'); setMobileNav(false) }}><Activity />安全状态</button><button className={view === 'audit' ? 'active' : ''} onClick={() => { setView('audit'); setMobileNav(false) }}><ScrollText />管理审计</button></nav>
        <footer><div><span>{session.admin.role}</span><strong>{session.admin.email}</strong></div><button className="icon-command" onClick={onLogout} title="退出管理端"><LogOut /></button></footer>
      </aside>
      <header className="mobile-header"><Brand /><button className="icon-command" onClick={() => setMobileNav((value) => !value)} title="打开导航"><Menu /></button></header>
      <div className="console-workspace">{view === 'security' ? <SecurityView session={session} /> : <AuditView />}</div>
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
      setSession(value); setAdminIdentity(value); setFlow(value.admin.twoFactorEnabled ? 'app' : 'mfa_setup')
    }).catch(() => { if (active) setFlow('login') })
    return () => { active = false }
  }, [])
  function authenticated(value: AdminSessionResponse) { setSession(value); setAdminIdentity(value); setFlow('app') }
  async function logout() { await adminApi.logout().catch(() => undefined); setSession(null); setAdminIdentity(null); setFlow('login') }
  function loginComplete(response: AdminLoginResponse) {
    if (response.session) { setSession(response.session); setAdminIdentity(response.session) }
    setFlow(response.state === 'mfa_required' ? 'mfa_challenge' : response.state === 'mfa_setup_required' ? 'mfa_setup' : 'app')
  }
  if (flow === 'loading') return <div className="loading-screen"><LoaderCircle className="spin" /><span>ADMIN CONTROL</span></div>
  if (flow === 'login') return <LoginScreen onComplete={loginComplete} />
  if (flow === 'mfa_challenge') return <ChallengeScreen onVerified={authenticated} onCancel={() => void logout()} />
  if (flow === 'mfa_setup') return <MfaSetupScreen onVerified={authenticated} onCancel={() => void logout()} />
  return session ? <Console session={session} onLogout={() => void logout()} /> : <LoginScreen onComplete={loginComplete} />
}
