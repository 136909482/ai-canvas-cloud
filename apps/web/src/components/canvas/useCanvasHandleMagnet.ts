import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  CANVAS_HANDLE_MAGNET_RADIUS,
  getCanvasHandleMagnetOffset,
  getCanvasHandleMagnetRegion,
  type CanvasHandleSide,
} from "./canvasHandleGeometry";

const HANDLE_SELECTOR = ".handle-orb-anchor";
const NODE_SELECTOR = ".react-flow__node";
const HANDLE_HIDE_DELAY_MS = 300;
const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, [contenteditable="true"], .react-flow__panel, .react-flow__minimap, .react-flow__resize-control';

export function useCanvasHandleMagnet({
  rootRef,
  zoomRef,
  viewportInteractingRef,
  nodeDraggingRef,
  enabled,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  zoomRef: RefObject<number>;
  viewportInteractingRef: RefObject<boolean>;
  nodeDraggingRef: RefObject<boolean>;
  enabled: boolean;
}) {
  const resetRef = useRef<(() => void) | null>(null);
  const resetMagnet = useCallback(() => resetRef.current?.(), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let active: HTMLElement | null = null;
    let hoveredNode: HTMLElement | null = null;
    let hideTimeout: number | null = null;
    let frame: number | null = null;
    let pending: { x: number; y: number } | null = null;
    type HandlePoint = {
      handle: HTMLElement;
      node: Element | null;
      x: number;
      y: number;
      side: CanvasHandleSide;
    };
    let handleCells: Map<string, HandlePoint[]> | null = null;

    const invalidateGeometry = () => {
      handleCells = null;
    };
    const cellKey = (x: number, y: number) => `${x}:${y}`;
    const collectHandleCells = () => {
      const cells = new Map<string, HandlePoint[]>();
      root.querySelectorAll<HTMLElement>(HANDLE_SELECTOR).forEach((handle) => {
        const bounds = handle.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        const position = handle.dataset.handlepos;
        const side: CanvasHandleSide =
          position === "left" || position === "top" || position === "bottom"
            ? position
            : "right";
        const region = getCanvasHandleMagnetRegion(side);
        const key = cellKey(
          Math.floor((x + region.x) / CANVAS_HANDLE_MAGNET_RADIUS),
          Math.floor((y + region.y) / CANVAS_HANDLE_MAGNET_RADIUS),
        );
        const cell = cells.get(key) ?? [];
        cell.push({ handle, node: handle.closest(NODE_SELECTOR), x, y, side });
        cells.set(key, cell);
      });
      return cells;
    };

    const releaseHandle = () => {
      if (!active) return;
      active.style.removeProperty("--handle-magnet-x");
      active.style.removeProperty("--handle-magnet-y");
      active.removeAttribute("data-magnet-active");
      active = null;
    };
    const cancelHide = () => {
      if (hideTimeout !== null) window.clearTimeout(hideTimeout);
      hideTimeout = null;
    };
    const setHoveredNode = (node: HTMLElement | null) => {
      cancelHide();
      if (node === hoveredNode) return;
      releaseHandle();
      hoveredNode?.removeAttribute("data-handle-hover");
      hoveredNode = node;
      hoveredNode?.setAttribute("data-handle-hover", "true");
    };
    const scheduleHide = () => {
      // Keep controls clickable while crossing from the node to its handles.
      // Do not restart the countdown on every move across the empty canvas.
      if (!hoveredNode || hideTimeout !== null) return;
      hideTimeout = window.setTimeout(() => {
        hideTimeout = null;
        setHoveredNode(null);
      }, HANDLE_HIDE_DELAY_MS);
    };
    const reset = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      pending = null;
      releaseHandle();
      setHoveredNode(null);
      invalidateGeometry();
    };
    resetRef.current = reset;

    const isBlocked = () =>
      reducedMotion.matches ||
      document.documentElement.dataset.canvasPerformance === "performance" ||
      viewportInteractingRef.current ||
      nodeDraggingRef.current ||
      Boolean(
        root.querySelector(
          ".react-flow__connection, .handle-orb-anchor.clickconnecting",
        ),
      );

    const followPointer = () => {
      frame = null;
      const pointer = pending;
      pending = null;
      if (!pointer || !hoveredNode?.isConnected) {
        setHoveredNode(null);
        return;
      }
      if (isBlocked()) {
        releaseHandle();
        if (!hoveredNode.matches(":hover")) scheduleHide();
        return;
      }

      // Follow only handles belonging to the hovered node. Its outward circle
      // keeps the controls available while approaching them from the node body.
      handleCells ??= collectHandleCells();
      const cellX = Math.floor(pointer.x / CANVAS_HANDLE_MAGNET_RADIUS);
      const cellY = Math.floor(pointer.y / CANVAS_HANDLE_MAGNET_RADIUS);
      const candidates: HandlePoint[] = [];
      for (let x = cellX - 1; x <= cellX + 1; x++) {
        for (let y = cellY - 1; y <= cellY + 1; y++) {
          candidates.push(...(handleCells.get(cellKey(x, y)) ?? []));
        }
      }

      let nearest: {
        handle: HTMLElement;
        offset: { x: number; y: number };
        distance: number;
      } | null = null;
      for (const { handle, node, x, y, side } of candidates) {
        if (
          node !== hoveredNode ||
          !handle.isConnected ||
          !root.contains(handle)
        )
          continue;
        const dx = pointer.x - x;
        const dy = pointer.y - y;
        const offset = getCanvasHandleMagnetOffset(
          dx,
          dy,
          zoomRef.current,
          side,
        );
        const distance = Math.hypot(dx, dy);
        if (offset && (!nearest || distance < nearest.distance)) {
          nearest = { handle, offset, distance };
        }
      }

      if (nearest?.handle !== active) releaseHandle();
      if (!nearest) {
        if (!hoveredNode.matches(":hover")) scheduleHide();
        return;
      }
      cancelHide();
      active = nearest.handle;
      active.style.setProperty("--handle-magnet-x", `${nearest.offset.x}px`);
      active.style.setProperty("--handle-magnet-y", `${nearest.offset.y}px`);
      active.setAttribute("data-magnet-active", "true");
    };

    const onPointerMove = (event: PointerEvent) => {
      if (
        event.pointerType !== "mouse" ||
        event.buttons !== 0 ||
        !(event.target instanceof Element)
      ) {
        reset();
        return;
      }
      const node = event.target.closest<HTMLElement>(NODE_SELECTOR);
      if (node && root.contains(node)) setHoveredNode(node);
      if (event.target.closest(INTERACTIVE_SELECTOR)) {
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
        pending = null;
        releaseHandle();
        if (!node) scheduleHide();
        return;
      }
      pending = { x: event.clientX, y: event.clientY };
      if (frame === null) frame = window.requestAnimationFrame(followPointer);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (
        event.pointerType === "mouse" &&
        event.target instanceof Element &&
        event.target.closest(HANDLE_SELECTOR)
      ) {
        // Keep the displaced orb under the cursor until the compatibility
        // mousedown reaches React Flow and starts its native connection drag.
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
        pending = null;
        return;
      }
      reset();
    };
    const onPointerUp = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      // Also preserve click-to-connect through mouseup/click when no drag began.
      frame = window.requestAnimationFrame(reset);
    };
    const geometryObserver = new MutationObserver((mutations) => {
      if (
        mutations.some(
          (mutation) =>
            mutation.type === "childList" ||
            (mutation.target instanceof Element &&
              (mutation.target.matches(
                ".react-flow__node, .react-flow__viewport",
              ) ||
                (mutation.target.matches(HANDLE_SELECTOR) &&
                  mutation.target !== active))),
        )
      ) {
        invalidateGeometry();
      }
    });
    geometryObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "hidden"],
    });
    const resizeObserver = new ResizeObserver(reset);
    resizeObserver.observe(root);

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    // Do not capture or cancel the pointer: React Flow owns connection dragging.
    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointerleave", reset);
    root.addEventListener("pointercancel", reset);
    root.addEventListener("wheel", reset, { passive: true, capture: true });
    window.addEventListener("blur", reset);
    window.addEventListener("scroll", reset, true);
    document.addEventListener("visibilitychange", reset);
    reducedMotion.addEventListener("change", reset);
    return () => {
      reset();
      geometryObserver.disconnect();
      resizeObserver.disconnect();
      resetRef.current = null;
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointerleave", reset);
      root.removeEventListener("pointercancel", reset);
      root.removeEventListener("wheel", reset, true);
      window.removeEventListener("blur", reset);
      window.removeEventListener("scroll", reset, true);
      document.removeEventListener("visibilitychange", reset);
      reducedMotion.removeEventListener("change", reset);
    };
  }, [enabled, rootRef, zoomRef, viewportInteractingRef, nodeDraggingRef]);

  return resetMagnet;
}
