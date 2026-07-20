import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  HardDrive,
  IdCard,
  KeyRound,
  LogOut,
  Mail,
  MonitorCheck,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useAuthStore } from './useAuthStore'
import { useSettingsDialogStore } from '@/store/useSettingsDialogStore'
import { themeClasses } from '@/styles/themeClasses'

interface AccountSettingsPanelProps {
  onSignedOut: () => void
}

export function AccountMenu() {
  const session = useAuthStore((state) => state.session)
  const logout = useAuthStore((state) => state.logout)
  const openSettings = useSettingsDialogStore((state) => state.open)
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (!session) {
    return null
  }

  const openSettingsCategory = (category: 'devices' | 'models' | 'providers' | 'storage') => {
    setIsOpen(false)
    openSettings(category)
  }

  const menuItemClass = 'group flex min-h-8 w-full items-center gap-2 rounded-[6px] px-1.5 text-left text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent'

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        title={session.user.email}
        aria-label="用户菜单"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={`${themeClasses.iconButton} h-6 w-6 rounded-md`}
      >
        <UserRound className="h-3.5 w-3.5" />
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label="用户菜单"
          className={`absolute right-0 top-8 z-50 w-[180px] overflow-hidden rounded-[8px] ${themeClasses.strongPanel}`}
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-violet-400/25 bg-violet-400/10 text-violet-300">
              <UserRound className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-[11px] font-semibold ${themeClasses.textPrimary}`}>
                {session.user.email}
              </span>
              <span className={`mt-0.5 block truncate text-[9px] ${themeClasses.textMuted}`}>
                个人账号 · UID {session.user.userNumber}
              </span>
            </span>
          </div>

          <div className="space-y-0.5 p-1.5">
            <button type="button" role="menuitem" disabled className={menuItemClass}>
              <IdCard className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">个人资料</span>
              <span className="text-[9px] text-[var(--text-muted)]">待开放</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openSettingsCategory('storage')}
              className={menuItemClass}
            >
              <HardDrive className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">存储空间</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openSettingsCategory('devices')}
              className={menuItemClass}
            >
              <MonitorCheck className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">登录设备</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openSettingsCategory('providers')}
              className={menuItemClass}
            >
              <KeyRound className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">Cloud 服务商</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openSettingsCategory('models')}
              className={menuItemClass}
            >
              <Settings className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">设置</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>

          <div className="border-t border-[var(--border-subtle)] bg-[var(--control-bg)] p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                void logout()
              }}
              className={menuItemClass}
            >
              <LogOut className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1">退出登录</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AccountSettingsPanel({ onSignedOut }: AccountSettingsPanelProps) {
  const session = useAuthStore((state) => state.session)
  const logout = useAuthStore((state) => state.logout)

  if (!session) {
    return null
  }

  return (
    <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-violet-400/25 bg-violet-400/10 text-violet-300">
            <UserRound className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className={`block truncate text-sm font-semibold ${themeClasses.textPrimary}`}>
              {session.user.email}
            </span>
            <span className={`mt-1 block truncate text-xs ${themeClasses.textMuted}`}>
              个人账号
            </span>
          </span>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          已登录
        </span>
      </header>

      <div className="divide-y divide-[var(--border-subtle)] px-4">
        <div className="flex min-h-16 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--control-bg-hover)] text-[var(--text-secondary)]">
            <Mail className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-xs ${themeClasses.textMuted}`}>邮箱地址</span>
            <span className={`mt-1 block truncate text-sm font-medium ${themeClasses.textPrimary}`}>{session.user.email}</span>
          </span>
        </div>

        <div className="flex min-h-16 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--control-bg-hover)] text-[var(--text-secondary)]">
            <IdCard className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-xs ${themeClasses.textMuted}`}>用户编号</span>
            <span className={`mt-1 block font-mono text-sm font-semibold tracking-[0.08em] ${themeClasses.textPrimary}`}>UID {session.user.userNumber}</span>
          </span>
        </div>

      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-4 py-3">
        <span className={`text-xs ${themeClasses.textMuted}`}>设备会话可在“设备管理”中查看</span>
        <button
          type="button"
          onClick={() => {
            onSignedOut()
            void logout()
          }}
          className="inline-flex h-8 items-center gap-2 rounded-[8px] px-3 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
        >
          <LogOut className="h-3.5 w-3.5" />
          退出登录
        </button>
      </footer>
    </section>
  )
}
