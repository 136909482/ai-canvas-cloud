import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Loader2, LockKeyhole, LogIn, Sparkles, UserPlus } from 'lucide-react'
import { requestAuthPasswordReset, resetAuthPassword, verifyAuthEmail } from './api'
import { useAuthStore } from './useAuthStore'
import { themeClasses } from '@/styles/themeClasses'

interface AuthGateProps {
  children: ReactNode
}

type AuthMode = 'login' | 'register' | 'forgot' | 'reset'

function getSubmitLabel(mode: AuthMode, pending: boolean) {
  if (pending) {
    if (mode === 'login') {
      return '正在登录...'
    }

    if (mode === 'register') {
      return '正在创建...'
    }

    if (mode === 'forgot') {
      return '正在发送...'
    }

    return '正在重置...'
  }

  if (mode === 'login') {
    return '登录'
  }

  if (mode === 'register') {
    return '创建账号'
  }

  if (mode === 'forgot') {
    return '发送重置链接'
  }

  return '重置密码'
}

export function AuthGate({ children }: AuthGateProps) {
  const status = useAuthStore((state) => state.status)
  const session = useAuthStore((state) => state.session)
  const error = useAuthStore((state) => state.error)
  const checkSession = useAuthStore((state) => state.checkSession)
  const login = useAuthStore((state) => state.login)
  const register = useAuthStore((state) => state.register)
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [emailVerificationStatus, setEmailVerificationStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [emailVerificationMessage, setEmailVerificationMessage] = useState<string | null>(null)
  const verificationConsumedRef = useRef(false)

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  useEffect(() => {
    if (window.location.pathname !== '/auth/reset-password') {
      return
    }

    const token = new URLSearchParams(window.location.search).get('token')

    if (!token) {
      setMode('forgot')
      setSubmitError('重置链接缺少 token，请重新发送重置邮件。')
      return
    }

    setResetToken(token)
    setMode('reset')
  }, [])

  useEffect(() => {
    if (verificationConsumedRef.current || window.location.pathname !== '/auth/verify-email') {
      return
    }

    const token = new URLSearchParams(window.location.search).get('token')

    if (!token) {
      return
    }

    verificationConsumedRef.current = true
    setEmailVerificationStatus('pending')
    setEmailVerificationMessage('正在验证邮箱...')

    verifyAuthEmail({ token })
      .then(async () => {
        window.history.replaceState(null, '', '/')
        setEmailVerificationStatus('success')
        setEmailVerificationMessage('邮箱已验证，可以继续使用 AI Canvas Cloud。')
        await checkSession()
      })
      .catch((error: unknown) => {
        window.history.replaceState(null, '', '/')
        setEmailVerificationStatus('error')
        setEmailVerificationMessage(error instanceof Error ? error.message : String(error))
      })
  }, [checkSession])

  const helperText = useMemo(() => {
    if (mode === 'login') {
      return '登录后进入你的 Cloud 个人空间。'
    }

    if (mode === 'register') {
      return '首个账号会自动创建个人工作区。'
    }

    if (mode === 'forgot') {
      return '输入邮箱后，我们会发送一封密码重置邮件。'
    }

    return '设置一个新密码，重置成功后请重新登录。'
  }, [mode])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)
    setSubmitMessage(null)
    setIsSubmitting(true)

    try {
      if (mode === 'login') {
        await login({ email, password })
      } else if (mode === 'register') {
        await register({ email, password })
      } else if (mode === 'forgot') {
        await requestAuthPasswordReset({ email })
        setSubmitMessage('如果这个邮箱存在，我们已经发送了密码重置链接。')
      } else {
        if (!resetToken) {
          throw new Error('重置链接缺少 token，请重新发送重置邮件。')
        }

        if (password !== confirmPassword) {
          throw new Error('两次输入的新密码不一致')
        }

        await resetAuthPassword({ token: resetToken, password })
        window.history.replaceState(null, '', '/')
        setPassword('')
        setConfirmPassword('')
        setResetToken(null)
        setMode('login')
        setSubmitMessage('密码已重置，请用新密码登录。')
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (status === 'checking') {
    return (
      <div className={`flex min-h-screen items-center justify-center ${themeClasses.canvas}`}>
        <div className={`inline-flex items-center gap-2 text-sm ${themeClasses.textMuted}`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          正在恢复会话...
        </div>
      </div>
    )
  }

  if (status === 'authenticated' && session && mode !== 'reset') {
    return children
  }

  return (
    <main className={`relative min-h-screen overflow-hidden ${themeClasses.canvas}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(45,212,191,0.14),transparent_28%),radial-gradient(circle_at_80%_22%,rgba(244,114,182,0.12),transparent_28%),linear-gradient(135deg,rgba(9,9,11,1),rgba(15,15,18,1)_52%,rgba(7,13,18,1))]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:42px_42px]" />

      <section className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="flex min-h-[38vh] items-end px-6 pb-8 pt-10 lg:min-h-screen lg:items-center lg:px-12 lg:py-12">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-[var(--text-secondary)] shadow-[var(--shadow-panel)] backdrop-blur-xl">
              <Sparkles className="h-4 w-4 text-[var(--accent-violet-strong)]" />
              AI Canvas Cloud
            </div>
            <h1 className="max-w-[15ch] text-[clamp(2.3rem,7vw,5.8rem)] font-semibold leading-[0.92] tracking-normal text-[var(--text-primary)]">
              把画布带到你的账号里
            </h1>
            <p className={`mt-5 max-w-xl text-sm leading-6 md:text-base ${themeClasses.textSecondary}`}>
              项目、任务和资产会进入云端个人空间；Provider 密钥和媒体资产继续按工作区边界隔离。
            </p>
          </div>
        </div>

        <div className="flex items-center px-4 pb-8 lg:px-8 lg:py-10">
          <div className={`w-full overflow-hidden rounded-[18px] ${themeClasses.strongPanel}`}>
            <div className="border-b border-[var(--border-subtle)] px-5 py-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[var(--accent-violet-muted)] bg-[var(--accent-violet-soft)] text-[var(--accent-violet-strong)]">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <h2 className={`mt-4 text-xl font-semibold ${themeClasses.textPrimary}`}>
                {mode === 'login'
                  ? '登录 AI Canvas'
                  : mode === 'register'
                    ? '创建 Cloud 账号'
                    : mode === 'forgot'
                      ? '找回密码'
                      : '重置密码'}
              </h2>
              <p className={`mt-1 text-sm ${themeClasses.textMuted}`}>{helperText}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
              {mode !== 'reset' ? (
                <label className="block">
                  <span className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}>邮箱</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                    required
                    className={`h-11 w-full px-3 text-sm ${themeClasses.input}`}
                    placeholder="you@example.com"
                  />
                </label>
              ) : null}

              {mode !== 'forgot' ? (
                <label className="block">
                  <span className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}>
                    {mode === 'reset' ? '新密码' : '密码'}
                  </span>
                  <div className="relative">
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      required
                      minLength={10}
                      className={`h-11 w-full px-3 pr-11 text-sm ${themeClasses.input}`}
                      placeholder="至少 10 个字符"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      onClick={() => setShowPassword((current) => !current)}
                      className={`${themeClasses.iconButton} absolute right-1.5 top-1.5 h-8 w-8`}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>
              ) : null}

              {mode === 'reset' ? (
                <label className="block">
                  <span className={`mb-1.5 block text-xs font-medium ${themeClasses.textSecondary}`}>确认新密码</span>
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={10}
                    className={`h-11 w-full px-3 text-sm ${themeClasses.input}`}
                    placeholder="再次输入新密码"
                  />
                </label>
              ) : null}

              {submitError || error ? (
                <div className="rounded-[10px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-500 dark:text-red-200">
                  {submitError || error}
                </div>
              ) : null}

              {submitMessage ? (
                <div className="rounded-[10px] border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-600 dark:text-emerald-200">
                  {submitMessage}
                </div>
              ) : null}

              {emailVerificationStatus !== 'idle' && emailVerificationMessage ? (
                <div className={`rounded-[10px] border px-3 py-2 text-xs leading-5 ${
                  emailVerificationStatus === 'error'
                    ? 'border-red-400/20 bg-red-500/10 text-red-500 dark:text-red-200'
                    : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-200'
                }`}
                >
                  {emailVerificationStatus === 'pending' ? (
                    <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin align-[-2px]" />
                  ) : null}
                  {emailVerificationMessage}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--text-primary)] px-4 text-sm font-semibold text-[var(--canvas-bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : mode === 'login'
                    ? <LogIn className="h-4 w-4" />
                    : mode === 'register'
                      ? <UserPlus className="h-4 w-4" />
                      : <LockKeyhole className="h-4 w-4" />}
                {getSubmitLabel(mode, isSubmitting)}
              </button>
            </form>

            <div className="border-t border-[var(--border-subtle)] bg-[var(--control-bg)] px-5 py-4 text-center text-xs text-[var(--text-muted)]">
              {mode === 'login' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot')
                      setSubmitError(null)
                      setSubmitMessage(null)
                    }}
                    className="font-semibold text-[var(--accent-violet-strong)] hover:underline"
                  >
                    忘记密码？
                  </button>
                  <span className="mx-2">·</span>
                  还没有账号？
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register')
                      setSubmitError(null)
                      setSubmitMessage(null)
                    }}
                    className="ml-1 font-semibold text-[var(--accent-violet-strong)] hover:underline"
                  >
                    创建一个
                  </button>
                </>
              ) : (
                <>
                  {mode === 'register' ? '已经有账号？' : '想起来了？'}
                  <button
                    type="button"
                    onClick={() => {
                      window.history.replaceState(null, '', '/')
                      setMode('login')
                      setResetToken(null)
                      setSubmitError(null)
                      setSubmitMessage(null)
                    }}
                    className="ml-1 font-semibold text-[var(--accent-violet-strong)] hover:underline"
                  >
                    去登录
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
