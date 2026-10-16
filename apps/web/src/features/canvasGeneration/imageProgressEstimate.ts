import type { GenerateTask } from "@/types";

type ImageProgressTask = Pick<
  GenerateTask,
  "status" | "phase" | "startedAt" | "telemetryStartedAt" | "resolution"
>;

export function getImageGenerationProgress(
  task: ImageProgressTask | undefined,
  now: number,
  queued = false,
) {
  if (!task)
    return {
      percent: queued ? 0 : null,
      label: queued ? "排队中" : "生成中",
      estimated: false,
      elapsedSeconds: null,
    };
  if (task.status === "done")
    return {
      percent: 100,
      label: "已完成",
      estimated: false,
      elapsedSeconds: null,
    };
  if (task.status === "error")
    return {
      percent: null,
      label: "生成失败",
      estimated: false,
      elapsedSeconds: null,
    };
  if (
    task.status === "queued" &&
    task.phase !== "polling" &&
    task.phase !== "persisting"
  )
    return {
      percent: 0,
      label: "排队中",
      estimated: false,
      elapsedSeconds: null,
    };

  const startedAt =
    task.telemetryStartedAt && Number.isFinite(task.telemetryStartedAt)
      ? task.telemetryStartedAt
      : task.startedAt;
  const elapsedMs =
    startedAt > 0 && Number.isFinite(startedAt)
      ? Math.max(0, now - startedAt)
      : 0;
  const durationMs =
    task.resolution === "4K"
      ? 95_000
      : task.resolution === "2K"
        ? 65_000
        : 45_000;
  // Providers expose task states rather than a measured percentage. Keep the
  // display explicitly estimated and below completion until the result is saved.
  const percent =
    task.phase === "persisting"
      ? 96
      : Math.min(
          92,
          Math.round(4 + 88 * (1 - Math.exp(-elapsedMs / durationMs))),
        );
  return {
    percent,
    label: task.phase === "persisting" ? "正在保存图片" : "生成中",
    estimated: true,
    elapsedSeconds: startedAt > 0 ? Math.floor(elapsedMs / 1000) : null,
  };
}
