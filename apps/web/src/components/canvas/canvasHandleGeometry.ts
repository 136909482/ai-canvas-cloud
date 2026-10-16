// Require a direct handle/body hit; nearby nodes must not capture a loose line.
export const CANVAS_CONNECTION_RADIUS = 0;

const MIN_HANDLE_SIZE = 24;
const MAX_HANDLE_SIZE = 52;
const TARGET_SCREEN_SIZE = 20;
export const CANVAS_HANDLE_MAGNET_RADIUS = 64;
const MAX_MAGNET_SCREEN_OFFSET = 96;

export type CanvasHandleSide = "left" | "right" | "top" | "bottom";

type HandleNodeBounds = {
  internals: { positionAbsolute: { x: number; y: number } };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
};

// Visual handles sit outside the card. Render lines at the node border without
// changing handle hit areas, IDs, or the geometry React Flow uses to connect.
export function getCanvasHandleBorderPoint(
  point: { x: number; y: number },
  side: CanvasHandleSide,
  node: HandleNodeBounds | null | undefined,
) {
  if (!node) return point;
  const width = node.measured?.width ?? node.width;
  const height = node.measured?.height ?? node.height;
  if (!width || !height) return point;
  const { x, y } = node.internals.positionAbsolute;
  if (side === "left" || side === "right") {
    return {
      x: side === "left" ? x : x + width,
      y: Math.max(y, Math.min(y + height, point.y)),
    };
  }
  return {
    x: Math.max(x, Math.min(x + width, point.x)),
    y: side === "top" ? y : y + height,
  };
}

export function getCanvasHandleMagnetRegion(side: CanvasHandleSide) {
  return {
    x:
      side === "right"
        ? CANVAS_HANDLE_MAGNET_RADIUS
        : side === "left"
          ? -CANVAS_HANDLE_MAGNET_RADIUS
          : 0,
    y:
      side === "bottom"
        ? CANVAS_HANDLE_MAGNET_RADIUS
        : side === "top"
          ? -CANVAS_HANDLE_MAGNET_RADIUS
          : 0,
    radius: CANVAS_HANDLE_MAGNET_RADIUS,
  };
}

export function getCanvasHandleSize(zoom: number) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.round(
    Math.min(
      MAX_HANDLE_SIZE,
      Math.max(MIN_HANDLE_SIZE, TARGET_SCREEN_SIZE / safeZoom),
    ),
  );
}

// Input deltas are screen pixels; output is in canvas coordinates. The fixed
// handle remains the origin, so following the pointer cannot accumulate drift.
export function getCanvasHandleMagnetOffset(
  deltaX: number,
  deltaY: number,
  zoom: number,
  side: CanvasHandleSide = "right",
) {
  const distance = Math.hypot(deltaX, deltaY);
  const region = getCanvasHandleMagnetRegion(side);
  // The origin is the inner tangent of the activity circle, so every allowed
  // position stays outside the node rather than crossing over its content.
  if (
    !Number.isFinite(distance) ||
    Math.hypot(deltaX - region.x, deltaY - region.y) > region.radius
  ) {
    return null;
  }
  if (distance === 0) return { x: 0, y: 0 };
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const maxOffset = MAX_MAGNET_SCREEN_OFFSET / safeZoom;
  const offset = Math.min((distance * 0.75) / safeZoom, maxOffset);
  return {
    x: (deltaX / distance) * offset,
    y: (deltaY / distance) * offset,
  };
}
