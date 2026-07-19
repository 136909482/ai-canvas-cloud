import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bell,
  BellRing,
  CheckCheck,
  CircleAlert,
  Megaphone,
  Trash2,
} from 'lucide-react'
import { useAuthStore } from '@/features/auth/useAuthStore'
import {
  useNotificationStore,
  type AppNotification,
  type NotificationKind,
} from '@/store/useNotificationStore'
import { themeClasses } from '@/styles/themeClasses'

type NotificationFilter = 'all' | 'unread'

const kindLabel: Record<NotificationKind, string> = {
  broadcast: '广播',
  error: '错误',
  system: '系统',
}

const kindTone: Record<NotificationKind, string> = {
  broadcast: 'bg-sky-500',
  error: 'bg-red-500',
  system: 'bg-amber-400',
}

function NotificationKindIcon({ kind }: { kind: NotificationKind }) {
  if (kind === 'broadcast') {
    return <Megaphone className="h-3.5 w-3.5" />
  }
  if (kind === 'error') {
    return <CircleAlert className="h-3.5 w-3.5" />
  }
  return <BellRing className="h-3.5 w-3.5" />
}

function formatNotificationTime(createdAt: string) {
  const elapsedMs = Date.now() - new Date(createdAt).getTime()
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) {
    return '刚刚'
  }

  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }

  const days = Math.floor(hours / 24)
  if (days < 7) {
    return `${days} 天前`
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(createdAt))
}

function NotificationRow({
  notification,
  onOpen,
  onDelete,
}: {
  notification: AppNotification
  onOpen: (notification: AppNotification) => void
  onDelete: (notificationId: string) => void
}) {
  const unread = notification.readAt === null

  return (
    <div className={`group relative border-b border-[var(--border-subtle)] last:border-b-0 transition hover:bg-[var(--control-bg-hover)] ${unread ? 'bg-[color-mix(in_srgb,var(--control-bg-hover)_58%,transparent)]' : ''}`}>
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="grid w-full grid-cols-[2px_1fr] gap-3 py-3 pl-3.5 pr-11 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/60"
      >
        <span className={`h-full min-h-11 w-0.5 rounded-full ${kindTone[notification.kind]}`} aria-hidden="true" />
        <span className="min-w-0">
          <span className="flex min-w-0 items-start justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`shrink-0 ${notification.kind === 'error' ? 'text-red-500 dark:text-red-300' : notification.kind === 'broadcast' ? 'text-sky-500 dark:text-sky-300' : 'text-amber-600 dark:text-amber-300'}`}>
                <NotificationKindIcon kind={notification.kind} />
              </span>
              <span className={`truncate text-xs font-semibold ${themeClasses.textPrimary}`}>{notification.title}</span>
              {notification.occurrences > 1 ? (
                <span className="shrink-0 rounded-full bg-[var(--control-bg-hover)] px-1.5 py-0.5 text-[9px] tabular-nums text-[var(--text-muted)]">
                  ×{notification.occurrences}
                </span>
              ) : null}
            </span>
            <span className={`shrink-0 text-[9px] ${themeClasses.textMuted}`}>{formatNotificationTime(notification.createdAt)}</span>
          </span>
          {notification.message ? (
            <span className={`mt-1.5 block whitespace-pre-wrap break-words text-[11px] leading-4 ${themeClasses.textMuted}`}>
              {notification.message}
            </span>
          ) : null}
          <span className={`mt-2 flex items-center gap-2 text-[9px] ${themeClasses.textMuted}`}>
            <span>{kindLabel[notification.kind]}</span>
            {unread ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-red-500" aria-label="未读" /> : null}
          </span>
        </span>
      </button>
      <button
        type="button"
        title="删除通知"
        aria-label={`删除通知：${notification.title}`}
        onClick={() => onDelete(notification.id)}
        className={`${themeClasses.iconButton} absolute right-2.5 top-2.5 h-7 w-7 text-[var(--text-muted)] opacity-70 hover:text-red-500 focus-visible:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function NotificationCenterButton() {
  const emailVerified = useAuthStore((state) => state.session?.user.emailVerified ?? true)
  const items = useNotificationStore((state) => state.items)
  const markRead = useNotificationStore((state) => state.markRead)
  const markAllRead = useNotificationStore((state) => state.markAllRead)
  const remove = useNotificationStore((state) => state.remove)
  const [isOpen, setIsOpen] = useState(false)
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const unreadCount = items.reduce((count, item) => count + Number(item.readAt === null), 0)
  const visibleItems = useMemo(
    () => filter === 'unread' ? items.filter((item) => item.readAt === null) : items,
    [filter, items],
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node
        && !containerRef.current?.contains(event.target)
        && !panelRef.current?.contains(event.target)
      ) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleOpenNotification = (notification: AppNotification) => {
    markRead(notification.id)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title="通知"
        aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : '通知'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        data-testid="notification-center-button"
        onClick={() => setIsOpen((current) => !current)}
        className={`${themeClasses.iconButton} relative h-6 w-6 rounded-md ${isOpen ? themeClasses.iconButtonActive : ''}`}
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 ? (
          <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-[var(--panel-bg-strong)]" aria-hidden="true" />
        ) : null}
      </button>

      {isOpen ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="通知中心"
          className={`fixed right-4 z-[70] flex w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg ${emailVerified ? 'top-14 max-h-[min(32rem,calc(100vh-5rem))]' : 'top-[13.5rem] max-h-[calc(100vh-15rem)] sm:top-[10.5rem] sm:max-h-[calc(100vh-12rem)]'} ${themeClasses.strongPanel}`}
        >
          <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3.5 py-3">
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${themeClasses.textPrimary}`}>通知</span>
              <span className={`mt-0.5 block text-[10px] ${themeClasses.textMuted}`}>
                {unreadCount > 0 ? `${unreadCount} 条未读` : '没有未读消息'}
              </span>
            </span>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--control-bg-hover)] disabled:cursor-default disabled:opacity-40"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              全部已读
            </button>
          </header>

          <div className="border-b border-[var(--border-subtle)] px-3.5 py-2">
            <div className="grid h-7 grid-cols-2 gap-1 rounded-md bg-[var(--control-bg)] p-0.5" role="tablist" aria-label="通知筛选">
              {(['all', 'unread'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                  className={`rounded-[5px] text-[10px] font-medium transition ${filter === value ? 'bg-[var(--control-bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                >
                  {value === 'all' ? `全部 ${items.length}` : `未读 ${unreadCount}`}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border-subtle)] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
            {visibleItems.length > 0 ? (
              visibleItems.map((notification) => (
                <NotificationRow key={notification.id} notification={notification} onOpen={handleOpenNotification} onDelete={remove} />
              ))
            ) : (
              <div className="flex min-h-44 flex-col items-center justify-center px-6 text-center">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--control-bg-hover)] text-[var(--text-muted)]">
                  <Bell className="h-4 w-4" />
                </span>
                <span className={`mt-3 text-xs font-medium ${themeClasses.textPrimary}`}>
                  {filter === 'unread' ? '没有未读消息' : '暂无通知'}
                </span>
                <span className={`mt-1 text-[10px] leading-4 ${themeClasses.textMuted}`}>
                  广播、错误和系统消息会出现在这里
                </span>
              </div>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
