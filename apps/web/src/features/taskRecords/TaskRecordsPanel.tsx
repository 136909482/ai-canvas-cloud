import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  History,
  Loader2,
  RotateCcw,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type {
  GenerationTaskRecordSummary,
  GenerationTaskRecordsResponse,
} from "@ai-canvas-cloud/contracts";
import { CloudApiError } from "@/api/cloudApiClient";
import { backfillTerminalTaskRecords } from "@/features/taskRecords";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import { fetchTaskRecords } from "./api";
import { TaskRecordDetailDialog } from "./TaskRecordDetailDialog";

const STATUS_META: Record<
  GenerationTaskRecordSummary["status"],
  { label: string; Icon: LucideIcon; iconClass: string; badgeClass: string }
> = {
  succeeded: {
    label: "成功",
    Icon: CheckCircle2,
    iconClass: "bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
    badgeClass:
      "border-emerald-400/25 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  },
  failed: {
    label: "失败",
    Icon: XCircle,
    iconClass: "bg-red-400/10 text-red-500 dark:text-red-300",
    badgeClass:
      "border-red-400/25 bg-red-400/10 text-red-500 dark:text-red-300",
  },
  canceled: {
    label: "已取消",
    Icon: Ban,
    iconClass: "bg-[var(--control-bg-hover)] text-[var(--text-muted)]",
    badgeClass:
      "border-[var(--border-subtle)] bg-[var(--control-bg-hover)] text-[var(--text-muted)]",
  },
};

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function TaskRecordsPanel() {
  const [items, setItems] = useState<GenerationTaskRecordSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] =
    useState<GenerationTaskRecordSummary | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const response: GenerationTaskRecordsResponse =
        await fetchTaskRecords(cursor);
      setItems((current) =>
        cursor ? [...current, ...response.items] : response.items,
      );
      setNextCursor(response.nextCursor);
    } catch (caught) {
      setError(
        caught instanceof CloudApiError
          ? caught.message
          : "任务记录读取失败，请稍后重试。",
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void backfillTerminalTaskRecords(useTaskQueueStore.getState().tasks).then(
      () => {
        if (!cancelled) void load();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-[var(--text-secondary)]">
            云端任务记录
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
          aria-label="刷新任务记录"
          title="刷新任务记录"
        >
          <RotateCcw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>
      <div className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--control-bg)]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-xs text-[var(--text-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在读取任务记录
          </div>
        ) : error && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-xs text-red-400">
            <CircleAlert className="h-3.5 w-3.5" />
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--control-bg-hover)] text-[var(--text-muted)]">
              <History className="h-5 w-5" />
            </span>
            <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
              还没有任务记录
            </p>
            <p className="text-[11px] leading-5 text-[var(--text-muted)]">
              在画布中发起图像或视频生成后，脱敏记录会保存在这里。
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-[var(--border-subtle)]">
              {items.map((item) => {
                const meta = STATUS_META[item.status];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDetailRecord(item)}
                    className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--control-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/50"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${meta.iconClass}`}
                    >
                      <meta.Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                          {item.title}
                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                        >
                          {meta.label}
                        </span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {formatDuration(item.durationMs)}
                        </span>
                        {item.status === "succeeded" ? (
                          <span>生成 {item.resultCount} 个结果</span>
                        ) : null}
                        <span>{formatTime(item.completedAt)}</span>
                      </span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
            {nextCursor ? (
              <div className="flex justify-center border-t border-[var(--border-subtle)] py-3">
                <button
                  type="button"
                  onClick={() => void load(nextCursor)}
                  disabled={loadingMore}
                  className="rounded-[7px] border border-[var(--border-subtle)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--control-bg-hover)] disabled:opacity-50"
                >
                  {loadingMore ? "加载中..." : "加载更多"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {detailRecord ? (
        <TaskRecordDetailDialog
          record={detailRecord}
          onClose={() => setDetailRecord(null)}
        />
      ) : null}
    </div>
  );
}
