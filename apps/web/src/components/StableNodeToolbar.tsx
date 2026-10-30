import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Position, useNodeId, useStore, useStoreApi } from "@xyflow/react";

import {
  getToolbarTransform,
  isNodeInViewport,
  shouldShowNodeToolbar,
  type ToolbarAlign,
} from "./stableNodeToolbarGeometry";

type StableNodeToolbarProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  children: ReactNode;
  nodeId?: string;
  isVisible?: boolean;
  position?: Position;
  offset?: number;
  align?: ToolbarAlign;
  hideWhenNodeOffscreen?: boolean;
  hideWhenNodeDragging?: boolean;
  hideWhenViewportMoving?: boolean;
  horizontalViewportPadding?: number;
  verticalViewportPadding?: number;
  portalToCanvasOverlay?: boolean;
};

export function StableNodeToolbar({
  children,
  nodeId,
  isVisible,
  position = Position.Top,
  offset = 10,
  align = "center",
  hideWhenNodeOffscreen = false,
  hideWhenNodeDragging = false,
  hideWhenViewportMoving = false,
  horizontalViewportPadding,
  verticalViewportPadding,
  portalToCanvasOverlay = false,
  className,
  style,
  ...rest
}: StableNodeToolbarProps) {
  const contextNodeId = useNodeId();
  const effectiveNodeId = nodeId ?? contextNodeId;
  const storeApi = useStoreApi();
  const nodeIsDragging = useStore((state) =>
    Boolean(
      hideWhenNodeDragging &&
      effectiveNodeId &&
      state.nodeLookup.get(effectiveNodeId)?.dragging,
    ),
  );
  const nodeInViewport = useStore((state) => {
    if (!hideWhenNodeOffscreen) return true;
    const node = effectiveNodeId
      ? state.nodeLookup.get(effectiveNodeId)
      : undefined;
    if (!node || node.hidden) return false;
    const [x, y, zoom] = state.transform;
    return isNodeInViewport(
      {
        ...node.internals.positionAbsolute,
        width: node.measured.width ?? node.internals.userNode.width ?? 0,
        height: node.measured.height ?? node.internals.userNode.height ?? 0,
      },
      { x, y, zoom },
      { width: state.width, height: state.height },
    );
  });
  const selectedNodeCount = useStore((state) => {
    let count = 0;
    for (const node of state.nodes) {
      if (node.selected) count += 1;
    }
    return count;
  });
  const portalRoot = useStore(
    (state) =>
      (portalToCanvasOverlay
        ? state.domNode?.parentElement
        : state.domNode?.querySelector(
            ".react-flow__renderer",
          )) as HTMLElement | null,
  );
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const positionSignatureRef = useRef("");
  const toolbarWidthRef = useRef(0);
  const toolbarHeightRef = useRef(0);
  const isActive = shouldShowNodeToolbar({
    isVisible,
    selectedNodeCount,
    nodeInViewport,
    nodeIsDragging,
  });

  useLayoutEffect(() => {
    if (!isActive || !effectiveNodeId) {
      return;
    }

    const updatePosition = () => {
      const toolbar = toolbarRef.current;
      const state = storeApi.getState();
      const node = state.nodeLookup.get(effectiveNodeId);
      if (!toolbar || !node) {
        return;
      }

      const x = node.internals.positionAbsolute.x;
      const y = node.internals.positionAbsolute.y;
      const width = node.measured.width ?? node.internals.userNode.width ?? 0;
      const height =
        node.measured.height ?? node.internals.userNode.height ?? 0;
      const [viewportX, viewportY, zoom] = state.transform;
      const zIndex = Math.max(node.internals.z + 1, Number(style?.zIndex) || 0);
      const signature = `${x}:${y}:${width}:${height}:${viewportX}:${viewportY}:${zoom}:${zIndex}:${position}:${offset}:${align}:${state.width}:${state.height}:${toolbarWidthRef.current}:${toolbarHeightRef.current}`;
      if (
        positionSignatureRef.current === signature &&
        toolbar.style.transform
      ) {
        return;
      }

      positionSignatureRef.current = signature;
      const transform = getToolbarTransform(
        { x, y, width, height },
        { x: viewportX, y: viewportY, zoom },
        position,
        offset,
        align,
        horizontalViewportPadding === undefined
          ? undefined
          : {
              viewportWidth: state.width,
              toolbarWidth: toolbarWidthRef.current,
              padding: horizontalViewportPadding,
            },
        verticalViewportPadding === undefined
          ? undefined
          : {
              viewportHeight: state.height,
              toolbarHeight: toolbarHeightRef.current,
              padding: verticalViewportPadding,
            },
      );
      toolbar.style.transform = transform;
      toolbar.style.zIndex = String(zIndex);
    };

    const toolbar = toolbarRef.current;
    const resizeObserver =
      horizontalViewportPadding === undefined &&
      verticalViewportPadding === undefined
        ? undefined
        : new ResizeObserver(([entry]) => {
            toolbarWidthRef.current = entry.borderBoxSize[0].inlineSize;
            toolbarHeightRef.current = entry.borderBoxSize[0].blockSize;
            updatePosition();
          });
    if (toolbar && resizeObserver) {
      toolbarWidthRef.current = toolbar.offsetWidth;
      toolbarHeightRef.current = toolbar.offsetHeight;
      resizeObserver.observe(toolbar);
    }
    updatePosition();
    const unsubscribe = storeApi.subscribe(updatePosition);
    return () => {
      unsubscribe();
      resizeObserver?.disconnect();
    };
  }, [
    align,
    effectiveNodeId,
    horizontalViewportPadding,
    verticalViewportPadding,
    isActive,
    offset,
    portalRoot,
    position,
    storeApi,
    style?.zIndex,
  ]);

  if (!isActive || !effectiveNodeId || !portalRoot) {
    return null;
  }

  const wrapperStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    ...style,
  };

  return createPortal(
    <div
      ref={toolbarRef}
      style={wrapperStyle}
      className={`react-flow__node-toolbar ${className ?? ""}`}
      data-id={effectiveNodeId}
      data-hide-when-viewport-moving={hideWhenViewportMoving || undefined}
      {...rest}
    >
      {children}
    </div>,
    portalRoot,
  );
}
