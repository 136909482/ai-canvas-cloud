export function getViewportMenuPosition(
  anchor: { left: number; top: number; bottom: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: "top" | "bottom",
) {
  const padding = 12;
  const gap = 8;
  const above = Math.max(0, anchor.top - gap - padding);
  const below = Math.max(0, viewport.height - anchor.bottom - gap - padding);
  const preferredSpace = preferred === "top" ? above : below;
  const otherSpace = preferred === "top" ? below : above;
  const placement =
    preferredSpace >= menu.height || preferredSpace >= otherSpace
      ? preferred
      : preferred === "top"
        ? "bottom"
        : "top";
  const maxHeight = placement === "top" ? above : below;
  const height = Math.min(menu.height, maxHeight);
  return {
    left: Math.max(
      padding,
      Math.min(anchor.left, viewport.width - menu.width - padding),
    ),
    top: placement === "top" ? anchor.top - gap - height : anchor.bottom + gap,
    maxHeight,
  };
}
