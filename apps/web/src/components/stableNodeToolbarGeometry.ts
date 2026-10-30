import { Position } from "@xyflow/react";

export type ToolbarAlign = "start" | "center" | "end";

export function shouldShowNodeToolbar({
  isVisible,
  selectedNodeCount,
  nodeInViewport,
  nodeIsDragging,
}: {
  isVisible?: boolean;
  selectedNodeCount: number;
  nodeInViewport: boolean;
  nodeIsDragging: boolean;
}) {
  return (
    !nodeIsDragging &&
    nodeInViewport &&
    (typeof isVisible === "boolean" ? isVisible : selectedNodeCount === 1)
  );
}

export function getAlignmentFactor(align: ToolbarAlign) {
  if (align === "start") return 0;
  if (align === "end") return 1;
  return 0.5;
}

export function isNodeInViewport(
  nodeRect: { x: number; y: number; width: number; height: number },
  viewport: { x: number; y: number; zoom: number },
  viewportSize: { width: number; height: number },
) {
  if (
    nodeRect.width <= 0 ||
    nodeRect.height <= 0 ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0
  ) {
    return false;
  }
  const left = nodeRect.x * viewport.zoom + viewport.x;
  const top = nodeRect.y * viewport.zoom + viewport.y;
  return (
    left < viewportSize.width &&
    top < viewportSize.height &&
    left + nodeRect.width * viewport.zoom > 0 &&
    top + nodeRect.height * viewport.zoom > 0
  );
}

export function getToolbarTransform(
  nodeRect: { x: number; y: number; width: number; height: number },
  viewport: { x: number; y: number; zoom: number },
  position: Position,
  offset: number,
  align: ToolbarAlign,
  horizontalBounds?: {
    viewportWidth: number;
    toolbarWidth: number;
    padding: number;
  },
  verticalBounds?: {
    viewportHeight: number;
    toolbarHeight: number;
    padding: number;
  },
) {
  const alignment = getAlignmentFactor(align);
  let x =
    (nodeRect.x + nodeRect.width * alignment) * viewport.zoom + viewport.x;
  let y = nodeRect.y * viewport.zoom + viewport.y - offset;
  let shiftX = -100 * alignment;
  let shiftY = -100;

  if (position === Position.Right) {
    x = (nodeRect.x + nodeRect.width) * viewport.zoom + viewport.x + offset;
    y = (nodeRect.y + nodeRect.height * alignment) * viewport.zoom + viewport.y;
    shiftX = 0;
    shiftY = -100 * alignment;
  } else if (position === Position.Bottom) {
    y = (nodeRect.y + nodeRect.height) * viewport.zoom + viewport.y + offset;
    shiftY = 0;
  } else if (position === Position.Left) {
    x = nodeRect.x * viewport.zoom + viewport.x - offset;
    y = (nodeRect.y + nodeRect.height * alignment) * viewport.zoom + viewport.y;
    shiftX = -100;
    shiftY = -100 * alignment;
  }

  if (horizontalBounds) {
    const { viewportWidth, toolbarWidth, padding } = horizontalBounds;
    const left = x + (toolbarWidth * shiftX) / 100;
    const boundedLeft = Math.max(
      padding,
      Math.min(left, viewportWidth - toolbarWidth - padding),
    );
    x += boundedLeft - left;
  }

  if (verticalBounds) {
    const { viewportHeight, toolbarHeight, padding } = verticalBounds;
    if (
      position === Position.Bottom &&
      y + toolbarHeight > viewportHeight - padding
    ) {
      const above =
        nodeRect.y * viewport.zoom + viewport.y - offset - toolbarHeight;
      if (above >= padding) y = above;
    }
    const top = y + (toolbarHeight * shiftY) / 100;
    y +=
      Math.max(
        padding,
        Math.min(top, viewportHeight - toolbarHeight - padding),
      ) - top;
  }

  return `translate(${x}px, ${y}px) translate(${shiftX}%, ${shiftY}%)`;
}
