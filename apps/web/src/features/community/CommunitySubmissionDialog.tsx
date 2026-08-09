import { useState, type FormEvent } from "react";
import { CircleAlert, Loader2, Send, X } from "lucide-react";
import { CloudApiError } from "@/api/cloudApiClient";
import { createCommunityPost } from "./api";

interface CommunitySubmissionDialogProps {
  assetId: string;
  imageUrl: string;
  defaultTitle: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

function message(error: unknown) {
  if (error instanceof CloudApiError) {
    if (error.code === "COMMUNITY_ASSET_NOT_ALLOWED")
      return "这张图片还不能投稿，请确认它是当前工作区中已完成的图片资产。";
    if (error.code === "ACCESS_DENIED")
      return "请先在账户设置中设置公开昵称并开启社区投稿授权。";
    if (error.code === "COMMUNITY_POST_DUPLICATE")
      return "这次投稿已经提交过了。";
  }
  return error instanceof Error ? error.message : "投稿失败，请稍后重试。";
}

export function CommunitySubmissionDialog({
  assetId,
  imageUrl,
  defaultTitle,
  onClose,
  onSubmitted,
}: CommunitySubmissionDialogProps) {
  const [title, setTitle] = useState(defaultTitle.slice(0, 120));
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createCommunityPost({
        assetId,
        title,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        idempotencyKey: crypto.randomUUID(),
      });
      onSubmitted?.();
      onClose();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="community-submit-title"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-lg overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2
            id="community-submit-title"
            className="text-sm font-semibold text-[var(--text-primary)]"
          >
            投稿到社区
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="关闭投稿窗口"
            title="关闭投稿窗口"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <img
            src={imageUrl}
            alt="待投稿图片"
            className="aspect-square w-full rounded-[7px] border border-[var(--border-subtle)] bg-black/10 object-contain"
          />
          <div className="space-y-3">
            <label className="block text-xs text-[var(--text-secondary)]">
              标题
              <input
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1.5 h-9 w-full rounded-[7px] border border-[var(--border-subtle)] bg-[var(--control-bg)] px-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-violet-400/60"
              />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">
              标签（用逗号分隔）
              <input
                maxLength={200}
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="例如：风景, 插画"
                className="mt-1.5 h-9 w-full rounded-[7px] border border-[var(--border-subtle)] bg-[var(--control-bg)] px-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-violet-400/60"
              />
            </label>
            <p className="text-[11px] leading-5 text-[var(--text-muted)]">
              投稿后会进入人工审核。社区只展示图片、标题、标签、发布时间和公开昵称，不会公开
              Prompt、项目结构或服务商信息。
            </p>
          </div>
        </div>
        {error ? (
          <div
            role="alert"
            className="mx-4 mb-3 flex items-start gap-2 text-xs text-red-400"
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[7px] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="inline-flex items-center gap-2 rounded-[7px] bg-violet-500 px-3 py-2 text-xs font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            提交审核
          </button>
        </div>
      </form>
    </div>
  );
}
