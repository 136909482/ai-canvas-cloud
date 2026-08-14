import { useState, type FormEvent } from "react";
import { CircleAlert, Loader2, Save, X } from "lucide-react";
import type { CommunityPostSummary } from "@ai-canvas-cloud/contracts";
import { CloudApiError } from "@/api/cloudApiClient";
import { updateCommunityPost } from "./api";

interface EditCommunityPostDialogProps {
  post: CommunityPostSummary;
  onClose: () => void;
  onUpdated: (post: CommunityPostSummary) => void;
}

function message(error: unknown) {
  if (error instanceof CloudApiError) {
    if (error.code === "COMMUNITY_POST_STATE_INVALID")
      return "这条投稿当前状态不能编辑。";
    if (error.code === "COMMUNITY_POST_NOT_FOUND")
      return "这条投稿不存在或已不可见。";
  }
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

const EDIT_HINT: Record<CommunityPostSummary["status"], string | null> = {
  pending_review: "修改后保持待审核，审核通过后公开。",
  rejected: "修改后将重新提交审核。",
  published:
    "修改后将重新进入审核，审核通过后重新公开；审核期间该投稿暂不公开展示。",
  withdrawn: null,
  removed: null,
};

export function EditCommunityPostDialog({
  post,
  onClose,
  onUpdated,
}: EditCommunityPostDialogProps) {
  const [title, setTitle] = useState(post.title);
  const [tags, setTags] = useState(post.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hint = EDIT_HINT[post.status];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await updateCommunityPost(post.id, {
        title,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      onUpdated(response.post);
      onClose();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="community-edit-title"
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-lg overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2
            id="community-edit-title"
            className="text-sm font-semibold text-[var(--text-primary)]"
          >
            编辑投稿
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="关闭编辑窗口"
            title="关闭编辑窗口"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-4">
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
          {hint ? (
            <p className="text-[11px] leading-5 text-[var(--text-muted)]">
              {hint}
            </p>
          ) : null}
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
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-2 rounded-[7px] bg-violet-500 px-3 py-2 text-xs font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? "正在保存" : "保存修改"}
          </button>
        </div>
      </form>
    </div>
  );
}
