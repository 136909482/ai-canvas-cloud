import { useEffect, useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import type { GenerationTaskRecordSummary } from "@ai-canvas-cloud/contracts";
import { useAuthStore } from "@/features/auth/useAuthStore";
import {
  loadLocalTaskDetail,
  type LocalTaskDetail,
} from "@/features/taskRecords/localTaskDetails";
import { loadRememberedLocalVaultKey } from "@/features/settings/localVault";
import { themeClasses } from "@/styles/themeClasses";

const STATUS_LABEL: Record<GenerationTaskRecordSummary["status"], string> = {
  succeeded: "成功",
  failed: "失败",
  canceled: "已取消",
};

const STATUS_CLASS: Record<GenerationTaskRecordSummary["status"], string> = {
  succeeded:
    "border-emerald-400/25 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  failed: "border-red-400/25 bg-red-400/10 text-red-500 dark:text-red-300",
  canceled:
    "border-[var(--border-subtle)] bg-[var(--control-bg-hover)] text-[var(--text-muted)]",
};

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 text-xs">
      <span className={themeClasses.textMuted}>{label}</span>
      <span
        className={`min-w-0 whitespace-pre-wrap break-words leading-5 ${themeClasses.textSecondary}`}
      >
        {children}
      </span>
    </div>
  );
}

export function TaskRecordDetailDialog({
  record,
  onClose,
}: {
  record: GenerationTaskRecordSummary;
  onClose: () => void;
}) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const [detail, setDetail] = useState<LocalTaskDetail | null>(null);
  const [detailState, setDetailState] = useState<
    "loading" | "available" | "missing" | "unsupported"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userId) {
        if (!cancelled) setDetailState("missing");
        return;
      }
      try {
        const key = await loadRememberedLocalVaultKey(userId);
        if (!key) {
          if (!cancelled) setDetailState("missing");
          return;
        }
        const local = await loadLocalTaskDetail(
          userId,
          record.clientTaskId,
          key,
        );
        if (!cancelled) {
          setDetail(local);
          setDetailState(local ? "available" : "missing");
        }
      } catch {
        if (!cancelled) setDetailState("unsupported");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, record.clientTaskId]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-record-detail-title"
    >
      <div className="max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-lg overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--panel-bg-strong)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <h2
            id="task-record-detail-title"
            className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]"
          >
            {record.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="关闭任务详情"
            title="关闭任务详情"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(100vh-10rem)] space-y-5 overflow-y-auto p-4">
          <section className="space-y-2">
            <h3 className={`text-xs font-medium ${themeClasses.textSecondary}`}>
              摘要
            </h3>
            <div className="space-y-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-3">
              <DetailRow label="状态">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[record.status]}`}
                >
                  {STATUS_LABEL[record.status]}
                </span>
              </DetailRow>
              <DetailRow label="耗时">
                {formatDuration(record.durationMs)}
              </DetailRow>
              {record.status === "succeeded" ? (
                <DetailRow label="结果数">{record.resultCount} 个</DetailRow>
              ) : null}
              {record.status === "failed" && record.failureCategory ? (
                <DetailRow label="失败原因">{record.failureCategory}</DetailRow>
              ) : null}
              <DetailRow label="完成时间">
                {formatTime(record.completedAt)}
              </DetailRow>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <Lock className="h-3 w-3 text-[var(--accent-violet-strong)]" />
              本机详情
            </h3>
            {detailState === "loading" ? (
              <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] px-3 py-4 text-xs text-[var(--text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在读取本机加密详情...
              </div>
            ) : detail && detailState === "available" ? (
              <div className="space-y-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-3">
                <DetailRow label="Prompt">{detail.prompt || "—"}</DetailRow>
                {detail.negativePrompt ? (
                  <DetailRow label="负向 Prompt">
                    {detail.negativePrompt}
                  </DetailRow>
                ) : null}
                <DetailRow label="模型">{detail.model || "—"}</DetailRow>
                {detail.apiProfileName ? (
                  <DetailRow label="服务商">{detail.apiProfileName}</DetailRow>
                ) : null}
                <DetailRow label="比例 / 分辨率">
                  {detail.ratio} / {detail.resolution}
                </DetailRow>
                <DetailRow label="操作类型">{detail.operationType}</DetailRow>
                {detail.referenceImageCount > 0 ? (
                  <DetailRow label="参考图">
                    {detail.referenceImageCount} 张
                  </DetailRow>
                ) : null}
                {detail.videoMode ? (
                  <DetailRow label="视频模式">{detail.videoMode}</DetailRow>
                ) : null}
                {detail.videoDuration ? (
                  <DetailRow label="视频时长">{detail.videoDuration}</DetailRow>
                ) : null}
                {detail.errorMsg ? (
                  <DetailRow label="错误信息">{detail.errorMsg}</DetailRow>
                ) : null}
                <p className="text-[10px] leading-4 text-[var(--text-muted)]">
                  本机详情加密保存在当前设备，不会上传到云端。
                </p>
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-[var(--border-subtle)] bg-[var(--control-bg)] px-3 py-4 text-[11px] leading-5 text-[var(--text-muted)]">
                {detailState === "unsupported"
                  ? "当前设备无法读取本地加密详情。"
                  : "这条记录的 Prompt 等敏感详情只保存在生成它的设备上；当前设备没有对应本地详情（或尚未启用本地存储）。"}
              </div>
            )}
          </section>

          {detailState === "available" && detail?.resultAssetIds.length ? (
            <section className="space-y-2">
              <h3
                className={`text-xs font-medium ${themeClasses.textSecondary}`}
              >
                结果资产
              </h3>
              <div className="space-y-1 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-3">
                {detail.resultAssetIds.map((assetId) => (
                  <p
                    key={assetId}
                    className="break-all font-mono text-[10px] text-[var(--text-muted)]"
                  >
                    {assetId}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
