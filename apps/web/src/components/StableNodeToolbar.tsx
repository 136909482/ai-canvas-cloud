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
      state.domNode?.querySelector(
        ".react-flow__renderer",
      ) as HTMLElement | null,
  );
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const positionSignatureRef = useRef("");
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
      const zIndex = node.internals.z + 1;
      const signature = `${x}:${y}:${width}:${height}:${viewportX}:${viewportY}:${zoom}:${zIndex}:${position}:${offset}:${align}`;
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
      );
      toolbar.style.transform = transform;
      toolbar.style.zIndex = String(zIndex);
    };

    updatePosition();
    return storeApi.subscribe(updatePosition);
  }, [
    align,
    effectiveNodeId,
    isActive,
    offset,
    portalRoot,
    position,
    storeApi,
  ]);

  if (!isActive || !effectiveNodeId || !portalRoot) {
    return null;
  }

  const wrapperStyle: CSSProperties = {
    position: "absolute",
    ...style,
  };

  return createPortal(
    <div
      ref={toolbarRef}
      style={wrapperStyle}
      className={`react-flow__node-toolbar ${className ?? ""}`}
      data-id={effectiveNodeId}
      {...rest}
    >
      {children}
    </div>,
    portalRoot,
  );
}
