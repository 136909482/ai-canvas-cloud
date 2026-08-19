function padTimePart(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * 统一的下载/导出文件命名：`ai_canvas{后缀}-{YYYYMMDD}-{HHMMSS}.{扩展名}`
 *
 * 生成内容没有用户可读的标题，因此固定使用 `ai_canvas` 前缀，避免出现
 * 无意义或重复的命名：
 * - `ai_canvas-20260817-143005.png`
 * - `ai_canvas-mask-20260817-143005.png`
 * - `ai_canvas-20260817-143010.mp4`
 *
 * 时间戳全补零并放在末尾，同前缀的多次下载按时间区分、不会覆盖，且按
 * 文件名排序即按时间排序。
 */
export function buildDownloadFileName({
  suffix = "",
  extension,
  timestamp = Date.now(),
}: {
  suffix?: string;
  extension: string;
  timestamp?: number;
}) {
  const date = new Date(timestamp);
  const timePart = `${date.getFullYear()}${padTimePart(date.getMonth() + 1)}${padTimePart(date.getDate())}-${padTimePart(date.getHours())}${padTimePart(date.getMinutes())}${padTimePart(date.getSeconds())}`;
  const cleanExtension = extension.replace(/^\./, "").toLowerCase();

  return `ai_canvas${suffix}-${timePart}.${cleanExtension}`;
}
