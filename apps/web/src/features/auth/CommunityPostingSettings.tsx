import { Send } from "lucide-react";
import { MyCommunityPosts } from "@/features/community/MyCommunityPosts";

export function CommunityPostingSettings() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div className="flex items-start gap-3 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] px-4 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--control-bg-hover)] text-[var(--text-secondary)]">
          <Send className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-2">
          <p className="text-xs leading-5 text-[var(--text-secondary)]">
            主动投稿的图片会进入人工审核，审核通过后在社区公开，展示图片、标题、标签、发布时间和你的用户昵称。
          </p>
          <p className="text-[11px] leading-5 text-[var(--text-muted)]">
            不会公开 Prompt、项目结构或服务商信息；未投稿的私有资产不会公开。
          </p>
        </div>
      </div>
      <MyCommunityPosts />
    </div>
  );
}
