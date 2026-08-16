import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Search, Tag as TagIcon } from "lucide-react";
import type { CommunityPublicPostSummary } from "@ai-canvas-cloud/contracts";
import { fetchCommunityPost, fetchCommunityPosts } from "./api";
import { CloudApiError } from "@/api/cloudApiClient";

export function CommunityBrowsePage() {
  const [items, setItems] = useState<CommunityPublicPostSummary[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [submittedTag, setSubmittedTag] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommunityPublicPostSummary | null>(null);

  const load = useCallback(
    async (next: string | null = null) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchCommunityPosts({
          q: submittedQuery,
          tag: submittedTag,
          cursor: next,
        });
        setItems((current) =>
          next ? [...current, ...response.items] : response.items,
        );
        setNextCursor(response.nextCursor);
      } catch (caught) {
        setError(
          caught instanceof CloudApiError ? caught.message : "社区内容加载失败",
        );
      } finally {
        setLoading(false);
      }
    },
    [submittedQuery, submittedTag],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmittedQuery(query);
    setSubmittedTag(tag);
  }

  const openDetail = useCallback(async (id: string) => {
    try {
      setDetail((await fetchCommunityPost(id)).post);
    } catch (caught) {
      setError(
        caught instanceof CloudApiError ? caught.message : "作品详情加载失败",
      );
    }
  }, []);

  // 支持从设置页"前往查看"带 ?postId= 进入并直接打开作品详情。
  useEffect(() => {
    const postId = new URLSearchParams(window.location.search).get("postId");
    if (!postId) {
      return;
    }
    void openDetail(postId);
    const url = new URL(window.location.href);
    url.searchParams.delete("postId");
    window.history.replaceState(null, "", url);
  }, [openDetail]);

  return (
    <main className="min-h-screen bg-[var(--canvas-bg)] px-4 py-5 text-[var(--text-primary)] sm:px-8">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          返回画布
        </a>
        <h1 className="text-base font-semibold">社区灵感</h1>
        <span className="w-20" />
      </header>
      <form
        onSubmit={submit}
        className="mx-auto mt-6 flex max-w-7xl flex-wrap gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-3"
      >
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3">
          <Search className="h-4 w-4 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
          />
        </label>
        <label className="flex min-w-[160px] items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3">
          <TagIcon className="h-4 w-4 text-[var(--text-muted)]" />
          <input
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="筛选标签"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400"
        >
          筛选
        </button>
      </form>
      {error ? (
        <p role="alert" className="mx-auto mt-5 max-w-7xl text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {loading && !items.length ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : null}
      {!loading && !items.length && !error ? (
        <p className="mx-auto max-w-7xl py-20 text-center text-sm text-[var(--text-muted)]">
          暂无公开作品
        </p>
      ) : null}
      <div className="mx-auto mt-6 grid max-w-7xl grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => void openDetail(item.id)}
            className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)]"
          >
            <img
              src={item.imageUrl ?? ""}
              alt={item.title}
              className="aspect-square w-full bg-black/20 object-contain"
            />
            <div className="flex min-h-[92px] flex-col p-3">
              <h2 className="line-clamp-2 min-h-10 text-sm font-medium">
                {item.title}
              </h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {item.publicNickname} ·{" "}
                {new Date(item.publishedAt).toLocaleDateString()}
              </p>
              <div className="mt-2 flex min-h-[18px] flex-wrap gap-1">
                {item.tags.map((value) => (
                  <span
                    key={value}
                    className="rounded bg-[var(--control-bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                  >
                    #{value}
                  </span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
      {nextCursor ? (
        <div className="flex justify-center py-8">
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(nextCursor)}
            className="rounded-md border border-[var(--border-subtle)] px-4 py-2 text-sm"
          >
            {loading ? "加载中..." : "加载更多"}
          </button>
        </div>
      ) : null}
      {detail ? (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDetail(null)}
        >
          <article
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-detail-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)]"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={detail.imageUrl ?? ""}
              alt={detail.title}
              className="max-h-[65vh] w-full object-contain"
            />
            <div className="p-5">
              <h2 id="community-detail-title" className="text-lg font-semibold">
                {detail.title}
              </h2>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                {detail.publicNickname} ·{" "}
                {new Date(detail.publishedAt).toLocaleString()}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {detail.tags.map((value) => (
                  <span
                    key={value}
                    className="rounded bg-[var(--control-bg-hover)] px-2 py-1 text-xs"
                  >
                    #{value}
                  </span>
                ))}
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </main>
  );
}
