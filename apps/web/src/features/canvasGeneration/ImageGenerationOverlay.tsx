import { useEffect, useState } from "react";
import { Clock3, Sparkles } from "lucide-react";
import { useTaskQueueStore } from "@/store/useTaskQueueStore";
import { getImageGenerationProgress } from "./imageProgressEstimate";
import styles from "./ImageGenerationOverlay.module.css";

export function ImageGenerationOverlay({
  taskId,
  queued = false,
}: {
  taskId?: string | null;
  queued?: boolean;
}) {
  const task = useTaskQueueStore((state) =>
    state.tasks.find((candidate) => candidate.id === taskId),
  );
  const [now, setNow] = useState(() => Date.now());
  const ticking =
    task?.status === "running" ||
    (task?.status === "queued" && task.phase === "polling");
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking, task?.id, task?.startedAt]);
  const progress = getImageGenerationProgress(task, now, queued);
  const waiting = progress.percent === 0;
  const elapsed = progress.elapsedSeconds;
  const elapsedLabel =
    elapsed === null
      ? null
      : `${Math.floor(elapsed / 60)
          .toString()
          .padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;

  return (
    <div
      className={`${styles.overlay} pointer-events-none absolute inset-0 z-[1] flex items-center justify-center overflow-hidden rounded-[inherit]`}
      data-waiting={waiting}
    >
      <div aria-hidden="true" className={styles.artwork} />
      <div className={`${styles.readout} relative z-10`}>
        <div className={styles.heading}>
          <span className={styles.label}>
            <span className="flex shrink-0 items-center justify-center">
              {waiting ? (
                <Clock3 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <span role="status">{progress.label}</span>
          </span>
          {progress.percent !== null ? (
            <span className={styles.percent} aria-hidden="true">
              {progress.percent}
              <span className={styles.percentUnit}>%</span>
            </span>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-label={progress.estimated ? "图片生成预计进度" : "图片生成进度"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent ?? undefined}
          aria-valuetext={
            progress.percent === null
              ? progress.label
              : `${progress.estimated ? "预计 " : ""}${progress.percent}%`
          }
          className={styles.track}
        >
          <span
            className={styles.fill}
            data-indeterminate={progress.percent === null}
            style={{ width: `${progress.percent ?? 32}%` }}
          />
        </div>
        <div className={styles.meta}>
          <span>
            {progress.estimated
              ? "预计进度"
              : waiting
                ? "等待开始"
                : progress.percent === 100
                  ? "生成完成"
                  : "等待返回结果"}
          </span>
          {elapsedLabel !== null ? (
            <span
              className="flex items-center gap-1 tabular-nums"
              aria-label={`已用 ${elapsed} 秒`}
              title={`已用 ${elapsed} 秒`}
            >
              <Clock3 className="h-3 w-3" aria-hidden="true" />
              {elapsedLabel}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
