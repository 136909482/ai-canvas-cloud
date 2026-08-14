import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Loader2, Pencil, RotateCcw, Undo2 } from "lucide-react";
import type { CommunityPostSummary } from "@ai-canvas-cloud/contracts";
import { CloudApiError } from "@/api/cloudApiClient";
import { fetchMyCommunityPosts, withdrawCommunityPost } from "./api";
import { EditCommunityPostDialog } from "./EditCommunityPostDialog";

const STATUS_LABEL: Record<CommunityPostSummary["status"], string> = {
  pending_review: "待审核",
  published: "已发布",
  rejected: "已拒绝",
  withdrawn: "已撤回",
  removed: "已下架",
};

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
    <section aria-labelledby="my-community-posts-heading" className="mt-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3
          id="my-community-posts-heading"
          className="text-xs font-medium text-[var(--text-secondary)]"
        >
          我的社区投稿
        </h3>
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
      <div className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-xs text-[var(--text-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在读取投稿记录
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 px-4 py-4 text-xs text-red-400">
            <CircleAlert className="h-3.5 w-3.5" />
            {error}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-4 text-xs text-[var(--text-muted)]">
            还没有投稿记录
          </p>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {STATUS_LABEL[item.status]} ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.status === "pending_review" ||
                  item.status === "published" ||
                  item.status === "rejected" ? (
                    <button
                      type="button"
                      onClick={() => setEditingPost(item)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border border-[var(--border-subtle)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] disabled:opacity-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                  ) : null}
                  {item.status === "pending_review" ||
                  item.status === "published" ? (
                    <button
                      type="button"
                      onClick={() => void withdraw(item.id)}
                      disabled={workingId === item.id}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border border-[var(--border-subtle)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] disabled:opacity-50"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      撤回
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
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
