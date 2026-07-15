import { useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '@ai-canvas-cloud/contracts'
import { Loader2, LogOut, MonitorCheck, ShieldCheck, UserRound, X } from 'lucide-react'
import { fetchAuthSessions, revokeAuthSession } from './api'
import { useAuthStore } from './useAuthStore'
import { themeClasses } from '@/styles/themeClasses'

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getSessionTitle(session: SessionSummary) {
  if (session.current) {
    return '当前设备'
  }

  return session.deviceLabel || '其他设备'
}

export function AccountMenu() {
  const session = useAuthStore((state) => state.session)
  const logout = useAuthStore((state) => state.logout)
  const [isOpen, setIsOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)

  const otherSessions = useMemo(
    () => sessions.filter((item) => !item.current),
    [sessions],
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    let ignore = false
    setIsLoadingSessions(true)
    setSessionsError(null)

    fetchAuthSessions()
      .then((response) => {
        if (!ignore) {
          setSessions(response.sessions)
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setSessionsError(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoadingSessions(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [isOpen])

  if (!session) {
    return null
  }

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId)
    setSessionsError(null)

    try {
      await revokeAuthSession(sessionId)
      setSessions((current) => current.filter((item) => item.id !== sessionId))
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : String(error))
    } finally {
      setRevokingSessionId(null)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        title={session.user.email}
        aria-label="账号"
        onClick={() => setIsOpen((current) => !current)}
        className={`${themeClasses.iconButton} h-6 min-w-6 rounded-md px-1.5 text-[10px] font-semibold`}
      >
        <UserRound className="h-3.5 w-3.5" />
      </button>

      {isOpen ? (
        <div className={`absolute right-0 top-8 z-50 w-80 overflow-hidden rounded-[16px] ${themeClasses.strongPanel}`}>
          <div className="relative border-b border-[var(--border-subtle)] px-3 py-3">
            <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
            </div>
            <div className={`max-w-[14rem] truncate text-xs font-semibold ${themeClasses.textPrimary}`}>
              {session.user.email}
            </div>
            <div className={`mt-1 max-w-[14rem] truncate text-[10px] ${themeClasses.textMuted}`}>
              {session.workspace.name}
            </div>
          </div>

          <div className="px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${themeClasses.textMuted}`}>
                活跃会话
              </div>
              {isLoadingSessions ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" /> : null}
            </div>

            <div className="space-y-2">
              {sessions.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center gap-2 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--control-bg)] px-2.5 py-2"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-black/10 text-[var(--text-secondary)] dark:bg-white/5">
                    <MonitorCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-xs font-medium ${themeClasses.textPrimary}`}>
                      {getSessionTitle(item)}
                    </div>
                    <div className={`mt-0.5 truncate text-[10px] ${themeClasses.textMuted}`}>
                      {item.current ? '正在使用' : `最近 ${formatSessionTime(item.lastUsedAt)}`}
                    </div>
                  </div>
                  {item.current ? (
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
                      当前
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={revokingSessionId === item.id}
                      onClick={() => void handleRevokeSession(item.id)}
                      className={`${themeClasses.iconButton} h-7 w-7 rounded-lg opacity-80 transition group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50`}
                      aria-label="下线此设备"
                      title="下线此设备"
                    >
                      {revokingSessionId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              ))}

              {!isLoadingSessions && sessions.length === 0 ? (
                <div className={`rounded-[12px] border border-[var(--border-subtle)] px-3 py-3 text-xs ${themeClasses.textMuted}`}>
                  暂时没有可显示的活跃会话。
                </div>
              ) : null}
            </div>

            {sessionsError ? (
              <div className="mt-2 rounded-[10px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-[10px] leading-4 text-red-500 dark:text-red-200">
                {sessionsError}
              </div>
            ) : null}
          </div>

          <div className="border-t border-[var(--border-subtle)] bg-[var(--control-bg)] px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false)
                void logout()
              }}
              className="flex h-9 w-full items-center justify-between rounded-[10px] px-2 text-left text-xs text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            >
              <span className="inline-flex items-center gap-2">
                <LogOut className="h-3.5 w-3.5" />
                退出登录
              </span>
              {otherSessions.length > 0 ? (
                <span className="text-[10px] text-[var(--text-muted)]">{otherSessions.length} 台其他设备</span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
