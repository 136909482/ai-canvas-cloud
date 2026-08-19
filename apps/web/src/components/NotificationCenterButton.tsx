import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AnnouncementCategory,
  AnnouncementTimelineItem,
} from "@ai-canvas-cloud/contracts";
import {
  Bell,
  BellRing,
  CheckCheck,
  CircleAlert,
  Clock3,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { fetchAnnouncements, markAnnouncementsRead } from "@/api/announcements";
import { useAuthStore } from "@/features/auth/useAuthStore";
import {
  useNotificationStore,
  type AppNotification,
  type NotificationKind,
} from "@/store/useNotificationStore";
import { themeClasses } from "@/styles/themeClasses";

type CenterView = "notifications" | "timeline";

const kindLabel: Record<NotificationKind, string> = {
  broadcast: "公告",
  error: "错误",
  system: "系统",
};

const kindBadgeClass: Record<NotificationKind, string> = {
  broadcast: "border-sky-400/25 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  error: "border-red-400/25 bg-red-400/10 text-red-500 dark:text-red-300",
  system:
    "border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-300",
};

const categoryLabel: Record<AnnouncementCategory, string> = {
  notice: "平台通知",
  product_update: "产品更新",
  maintenance: "维护提醒",
};

const categoryBadgeClass: Record<AnnouncementCategory, string> = {
  notice:
    "border-emerald-400/25 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  product_update:
    "border-blue-400/25 bg-blue-400/10 text-blue-600 dark:text-blue-300",
  maintenance:
    "border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-300",
};

function formatRelativeTime(createdAt: string) {
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return "刚刚";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} 个月前` : `${Math.floor(months / 12)} 年前`;
}

function formatExactTime(createdAt: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(createdAt));
}

function LocalNotificationRow({
  notification,
  onOpen,
  onDelete,
}: {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  onDelete: (notificationId: string) => void;
}) {
  const unread = notification.readAt === null;
  return (
    <div
      className={`group relative border-b border-[var(--border-subtle)] last:border-b-0 transition hover:bg-[var(--control-bg-hover)] ${unread ? "bg-[color-mix(in_srgb,var(--control-bg-hover)_62%,transparent)]" : ""}`}
    >
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="grid w-full grid-cols-[8px_1fr] gap-2.5 py-3 pl-3.5 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/60"
      >
        <span
          className={`mt-1.5 h-2 w-2 rounded-full ${notification.kind === "error" ? "bg-red-500" : notification.kind === "broadcast" ? "bg-sky-500" : "bg-amber-400"} ${unread ? "" : "opacity-40"}`}
          aria-hidden="true"
        />
        <span className="min-w-0">
          <span className="flex min-w-0 items-start justify-between gap-3">
            <span
              className={`truncate text-xs ${unread ? "font-semibold" : "font-medium"} ${unread ? themeClasses.textPrimary : themeClasses.textSecondary}`}
            >
              {notification.title}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {unread ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-red-500"
                  aria-label="未读"
                />
              ) : null}
              <span className={`text-[9px] ${themeClasses.textMuted}`}>
                {formatRelativeTime(notification.createdAt)}
              </span>
            </span>
          </span>
          {notification.message ? (
            <span
              className={`mt-1.5 block whitespace-pre-wrap break-words text-[11px] leading-4 ${themeClasses.textMuted}`}
            >
              {notification.message}
            </span>
          ) : null}
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px]">
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium ${kindBadgeClass[notification.kind]}`}
            >
              {kindLabel[notification.kind]}
            </span>
            {notification.occurrences > 1 ? (
              <span className={themeClasses.textMuted}>
                重复 {notification.occurrences} 次
              </span>
            ) : null}
          </span>
        </span>
      </button>
      <button
        type="button"
        title="删除通知"
        aria-label={`删除通知：${notification.title}`}
        onClick={() => onDelete(notification.id)}
        className={`${themeClasses.iconButton} absolute right-2.5 top-2.5 h-7 w-7 text-[var(--text-muted)] transition-opacity hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Timeline({
  items,
  onRead,
}: {
  items: AnnouncementTimelineItem[];
  onRead: (id: string) => void;
}) {
  if (!items.length) return <EmptyState view="timeline" />;
  return (
    <ol className="relative space-y-3 px-3.5 py-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="relative grid grid-cols-[12px_1fr] gap-2.5 before:absolute before:left-[19.5px] before:top-0 before:-bottom-3 before:w-px before:bg-[var(--border-subtle)] before:content-[''] last:before:hidden"
        >
          <span
            className={`relative z-10 mt-4 h-3 w-3 rounded-full border-[3px] border-[var(--panel-bg-strong)] ${item.category === "maintenance" ? "bg-amber-400" : item.category === "product_update" ? "bg-blue-500" : "bg-emerald-500"}`}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => onRead(item.id)}
            className="min-w-0 -mr-3.5 rounded-[8px] px-2.5 py-2 text-left transition hover:bg-[var(--control-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <span className="flex items-start justify-between gap-3">
              <strong
                className={`min-w-0 break-words text-xs leading-5 ${item.readAt === null ? themeClasses.textPrimary : themeClasses.textSecondary}`}
              >
                {item.title}
              </strong>
              {item.readAt === null ? (
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                  aria-label="未读"
                />
              ) : null}
            </span>
            <span
              className={`mt-1 block whitespace-pre-wrap break-words text-[11px] leading-[1.15rem] ${themeClasses.textMuted}`}
            >
              {item.content}
            </span>
            <span
              className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] ${themeClasses.textMuted}`}
            >
              <span
                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium ${categoryBadgeClass[item.category]}`}
              >
                {categoryLabel[item.category]}
              </span>
              <span>{formatRelativeTime(item.publishedAt)}</span>
              <span
                className="ml-auto text-[9px]"
                title={formatExactTime(item.publishedAt)}
              >
                {formatExactTime(item.publishedAt)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function EmptyState({ view }: { view: CenterView }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--control-bg-hover)] text-[var(--text-muted)]">
        {view === "timeline" ? (
          <Clock3 className="h-4 w-4" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
      </span>
      <span className={`mt-3 text-xs font-medium ${themeClasses.textPrimary}`}>
        {view === "timeline" ? "暂无平台动态" : "暂无通知"}
      </span>
      <span className={`mt-1 text-[10px] leading-4 ${themeClasses.textMuted}`}>
        {view === "timeline"
          ? "产品更新、维护和平台通知会沉淀在这里"
          : "任务状态、错误和系统消息会出现在这里"}
      </span>
    </div>
  );
}

export function NotificationCenterButton() {
  const emailVerified = useAuthStore(
    (state) => state.session?.user.emailVerified ?? true,
  );
  const localItems = useNotificationStore((state) => state.items);
  const markLocalRead = useNotificationStore((state) => state.markRead);
  const markAllLocalRead = useNotificationStore((state) => state.markAllRead);
  const remove = useNotificationStore((state) => state.remove);
  const [cloudItems, setCloudItems] = useState<AnnouncementTimelineItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<CenterView>("notifications");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const localUnread = localItems.filter((item) => item.readAt === null).length;
  const cloudUnread = cloudItems.filter((item) => item.readAt === null).length;
  const unreadCount = localUnread + cloudUnread;
  async function refresh() {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetchAnnouncements();
      setCloudItems(response.items);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      )
        setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function readCloud(id: string) {
    const target = cloudItems.find((item) => item.id === id);
    if (!target || target.readAt) return;
    const readAt = new Date().toISOString();
    setCloudItems((current) =>
      current.map((item) => (item.id === id ? { ...item, readAt } : item)),
    );
    await markAnnouncementsRead([id]).catch(() => void refresh());
  }

  async function markEverythingRead() {
    markAllLocalRead();
    const ids = cloudItems
      .filter((item) => item.readAt === null)
      .map((item) => item.id);
    if (!ids.length) return;
    const readAt = new Date().toISOString();
    setCloudItems((current) =>
      current.map((item) =>
        item.readAt === null ? { ...item, readAt } : item,
      ),
    );
    await markAnnouncementsRead(ids).catch(() => void refresh());
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title="通知"
        aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知"}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        data-testid="notification-center-button"
        onClick={() => setIsOpen((current) => !current)}
        className={`${themeClasses.iconButton} relative h-6 w-6 rounded-md ${isOpen ? themeClasses.iconButtonActive : ""}`}
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 ? (
          <span
            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-[var(--panel-bg-strong)]"
            aria-hidden="true"
          />
        ) : null}
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="通知中心"
              className={`fixed right-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[14px] ${emailVerified ? "top-14 max-h-[min(36rem,calc(100vh-5rem))]" : "top-[13.5rem] max-h-[calc(100vh-15rem)] sm:top-[10.5rem] sm:max-h-[calc(100vh-12rem)]"} ${themeClasses.strongPanel}`}
            >
              <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Bell className="h-4 w-4 shrink-0 text-[var(--accent-violet-strong)]" />
                  <span
                    className={`truncate text-sm font-semibold ${themeClasses.textPrimary}`}
                  >
                    通知中心
                  </span>
                  {unreadCount > 0 ? (
                    <span className="inline-flex shrink-0 items-center rounded-full border border-red-400/25 bg-red-400/10 px-1.5 py-0.5 text-[9px] font-medium text-red-500 dark:text-red-300">
                      {unreadCount} 条未读
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    title="刷新"
                    aria-label="刷新通知"
                    onClick={() => void refresh()}
                    className={`${themeClasses.iconButton} h-7 w-7`}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                    />
                  </button>
                  <button
                    type="button"
                    title="全部已读"
                    aria-label="全部已读"
                    onClick={() => void markEverythingRead()}
                    disabled={unreadCount === 0}
                    className={`${themeClasses.iconButton} h-7 w-7 disabled:opacity-35`}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                </span>
              </header>
              <div className="border-b border-[var(--border-subtle)] px-3.5 py-2">
                <div
                  className="grid h-8 grid-cols-2 gap-1 rounded-md bg-[var(--control-bg)] p-0.5"
                  role="tablist"
                  aria-label="通知视图"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === "notifications"}
                    onClick={() => setView("notifications")}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-medium transition ${view === "notifications" ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
                  >
                    <BellRing className="h-3.5 w-3.5" />
                    通知{localUnread ? ` ${localUnread}` : ""}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === "timeline"}
                    onClick={() => setView("timeline")}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-medium transition ${view === "timeline" ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
                  >
                    <Clock3 className="h-3.5 w-3.5" />
                    时间线{cloudUnread ? ` ${cloudUnread}` : ""}
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                {loadError && view === "timeline" ? (
                  <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3.5 py-2 text-[10px] text-amber-600 dark:text-amber-300">
                    <CircleAlert className="h-3.5 w-3.5" />
                    云端公告暂时未同步，本地消息仍可查看
                  </div>
                ) : null}
                {view === "timeline" ? (
                  <Timeline
                    items={cloudItems}
                    onRead={(id) => void readCloud(id)}
                  />
                ) : localItems.length > 0 ? (
                  localItems.map((notification) => (
                    <LocalNotificationRow
                      key={notification.id}
                      notification={notification}
                      onOpen={(item) => markLocalRead(item.id)}
                      onDelete={remove}
                    />
                  ))
                ) : (
                  <EmptyState view="notifications" />
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
