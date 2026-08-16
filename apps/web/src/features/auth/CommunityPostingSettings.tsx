import { Globe, Send, ShieldCheck } from "lucide-react";
import { MyCommunityPosts } from "@/features/community/MyCommunityPosts";

export function CommunityPostingSettings() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
        <div className="flex items-start gap-4 px-5 py-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-violet-400/10 text-violet-500 dark:text-violet-300">
            <Send className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              投稿说明
            </h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              主动投稿的图片会进入人工审核，审核通过后在社区公开。
            </p>
          </div>
        </div>
        <div className="grid gap-3 border-t border-[var(--border-subtle)] px-5 py-4 sm:grid-cols-2">
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-violet-400/10 text-violet-500 dark:text-violet-300">
              <Globe className="h-3.5 w-3.5" />
            </span>
            <p className="text-[11px] leading-5 text-[var(--text-secondary)]">
              社区公开：图片、标题、标签、发布时间和你的用户昵称
            </p>
          </div>
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] px-3 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[var(--control-bg-hover)] text-[var(--text-secondary)]">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
            <p className="text-[11px] leading-5 text-[var(--text-secondary)]">
              不会公开 Prompt、项目结构或服务商信息；未投稿的私有资产不会公开
            </p>
          </div>
        </div>
      </div>
      <MyCommunityPosts />
    </div>
  );
}
