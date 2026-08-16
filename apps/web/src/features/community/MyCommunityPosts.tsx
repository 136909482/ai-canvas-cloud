import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  Eye,
  Hourglass,
  Images,
  Loader2,
  Pencil,
  RotateCcw,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { CommunityPostSummary } from "@ai-canvas-cloud/contracts";
import { CloudApiError } from "@/api/cloudApiClient";
import { fetchMyCommunityPosts, withdrawCommunityPost } from "./api";
import { EditCommunityPostDialog } from "./EditCommunityPostDialog";

const STATUS_META: Record<
  CommunityPostSummary["status"],
  { label: string; Icon: LucideIcon; iconClass: string; badgeClass: string }
> = {
  pending_review: {
    label: "待审核",
    Icon: Hourglass,
    iconClass: "bg-amber-400/10 text-amber-600 dark:text-amber-300",
    badgeClass:
      "border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  },
  published: {
    label: "已发布",
    Icon: CheckCircle2,
    iconClass: "bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
    badgeClass:
      "border-emerald-400/25 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  },
  rejected: {
    label: "已拒绝",
    Icon: XCircle,
    iconClass: "bg-red-400/10 text-red-500 dark:text-red-300",
    badgeClass:
      "border-red-400/25 bg-red-400/10 text-red-500 dark:text-red-300",
  },
  withdrawn: {
    label: "已撤回",
    Icon: Undo2,
    iconClass: "bg-[var(--control-bg-hover)] text-[var(--text-muted)]",
    badgeClass:
      "border-[var(--border-subtle)] bg-[var(--control-bg-hover)] text-[var(--text-muted)]",
  },
  removed: {
    label: "已下架",
    Icon: Ban,
    iconClass: "bg-[var(--control-bg-hover)] text-[var(--text-muted)]",
    badgeClass:
      "border-[var(--border-subtle)] bg-[var(--control-bg-hover)] text-[var(--text-muted)]",
  },
};

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function MyCommunityPosts() {
  const [items, setItems] = useState<CommunityPostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<CommunityPostSummary | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await fetchMyCommunityPosts()).items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "投稿记录读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const withdraw = async (id: string) => {
    setWorkingId(id);
    try {
      const response = await withdrawCommunityPost(id);
      setItems((current) =>
        current.map((item) => (item.id === id ? response.post : item)),
      );
    } catch (caught) {
      setError(
        caught instanceof CloudApiError
          ? caught.message
          : "投稿撤回失败，请稍后重试",
      );
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section aria-labelledby="my-community-posts-heading">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h3
            id="my-community-posts-heading"
            className="text-xs font-medium text-[var(--text-secondary)]"
          >
            我的社区投稿
          </h3>
          {!loading && items.length > 0 ? (
            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
              共 {items.length} 条
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
          aria-label="刷新投稿记录"
          title="刷新投稿记录"
        >
          <RotateCcw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>
      <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-[var(--text-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在读取投稿记录
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-red-400">
            <CircleAlert className="h-3.5 w-3.5" />
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--control-bg-hover)] text-[var(--text-muted)]">
              <Images className="h-5 w-5" />
            </span>
            <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
              还没有投稿记录
            </p>
            <p className="text-[11px] leading-5 text-[var(--text-muted)]">
              在画布中选中图片节点，点击工具栏的投稿入口即可发起投稿。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {items.map((item) => {
              const meta = STATUS_META[item.status];
              return (
                <div
                  key={item.id}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--control-bg-hover)]"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${meta.iconClass}`}
                  >
                    <meta.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                        {item.title}
                      </p>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      {formatTime(item.createdAt)}
                      {item.tags.length > 0
                        ? ` · ${item.tags.join(" / ")}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    {item.status === "published" ? (
                      <a
                        href={`/community?postId=${encodeURIComponent(item.id)}`}
                        title="前往社区查看"
                        aria-label="前往社区查看"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--panel-bg-strong)] hover:text-[var(--text-primary)]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {item.status === "pending_review" ||
                    item.status === "published" ||
                    item.status === "rejected" ? (
                      <button
                        type="button"
                        onClick={() => setEditingPost(item)}
                        title="编辑投稿"
                        aria-label="编辑投稿"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--panel-bg-strong)] hover:text-[var(--text-primary)]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {item.status === "pending_review" ||
                    item.status === "published" ? (
                      <button
                        type="button"
                        onClick={() => void withdraw(item.id)}
                        disabled={workingId === item.id}
                        title="撤回投稿"
                        aria-label="撤回投稿"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--panel-bg-strong)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {workingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Undo2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editingPost ? (
        <EditCommunityPostDialog
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onUpdated={(updated) =>
            setItems((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            )
          }
        />
      ) : null}
    </section>
  );
}
