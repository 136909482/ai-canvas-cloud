export type NodeHeaderVariant = "embedded" | "floating";

const EMBEDDED_NODE_HEADER_CLASS_NAME =
  "node-drag-handle flex cursor-grab items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 select-none active:cursor-grabbing";
const FLOATING_NODE_HEADER_CLASS_NAME =
  "node-drag-handle absolute -top-6 left-1 z-10 flex h-5 w-max max-w-[220px] cursor-grab items-center gap-1.5 select-none active:cursor-grabbing";

export function getNodeHeaderScale(zoom: number) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(6, Math.max(1, 1 / safeZoom));
}

export function getNodeHeaderClassName(variant: NodeHeaderVariant) {
  return variant === "floating"
    ? FLOATING_NODE_HEADER_CLASS_NAME
    : EMBEDDED_NODE_HEADER_CLASS_NAME;
}
