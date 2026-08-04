export const CANVAS_CONNECTION_RADIUS = 32;

const MIN_HANDLE_SIZE = 24;
const MAX_HANDLE_SIZE = 52;
const TARGET_SCREEN_SIZE = 20;

export function getCanvasHandleSize(zoom: number) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.round(
    Math.min(
      MAX_HANDLE_SIZE,
      Math.max(MIN_HANDLE_SIZE, TARGET_SCREEN_SIZE / safeZoom),
    ),
  );
}
