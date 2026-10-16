import type { Connection, Handle, InternalNode } from "@xyflow/react";
import {
  getNodeConnectionInputs,
  getNodeConnectionOutput,
  getQuickCreateTargetHandle,
} from "@/features/nodeRegistry/protocol";
import { getCanvasHandleBorderPoint } from "./canvasHandleGeometry";

export function getCanvasBodyConnectionTarget(
  fromNode: InternalNode,
  fromHandle: Handle,
  node: InternalNode,
  handles: readonly Handle[],
) {
  if (
    fromNode.id === node.id ||
    fromNode.hidden ||
    fromNode.connectable === false ||
    node.hidden ||
    node.connectable === false
  )
    return null;

  const reverse = fromHandle.type === "target";
  const source = reverse ? node : fromNode;
  const target = reverse ? fromNode : node;
  const output = getNodeConnectionOutput(source.type);
  if (!output) return null;

  const candidates = handles.filter(
    (handle) =>
      handle.type === (reverse ? "source" : "target") &&
      getNodeConnectionInputs(
        target.type,
        (reverse ? fromHandle.id : handle.id) ?? null,
      ).includes(output),
  );
  const handle =
    candidates.find(
      (candidate) => candidate.id === getQuickCreateTargetHandle(node.type),
    ) ?? candidates[0];
  if (!handle) return null;

  const connection: Connection = {
    source: source.id,
    target: target.id,
    sourceHandle: (reverse ? handle.id : fromHandle.id) ?? null,
    targetHandle: (reverse ? fromHandle.id : handle.id) ?? null,
  };
  const { x, y } = node.internals.positionAbsolute;
  const point = getCanvasHandleBorderPoint(
    { x: x + handle.x + handle.width / 2, y: y + handle.y + handle.height / 2 },
    handle.position,
    node,
  );
  return { connection, handle, node, point };
}

export function getCanvasConnectionDropNode(
  root: HTMLElement | null,
  point: { x: number; y: number },
) {
  if (!root) return null;
  const hit = root.ownerDocument.elementFromPoint(point.x, point.y);
  if (!hit || !root.contains(hit)) return null;
  const nodeElement = hit.closest<HTMLElement>(".react-flow__node");
  if (!nodeElement || !root.contains(nodeElement)) return null;
  const bounds = nodeElement.getBoundingClientRect();
  if (
    point.x < bounds.left ||
    point.x > bounds.right ||
    point.y < bounds.top ||
    point.y > bounds.bottom
  )
    return null;
  return { hit, nodeElement, nodeId: nodeElement.dataset.id ?? "" };
}

export function resolveCanvasBodyConnection({
  root,
  point,
  fromNode,
  fromHandle,
  getNode,
}: {
  root: HTMLElement | null;
  point: { x: number; y: number };
  fromNode: InternalNode;
  fromHandle: Handle;
  getNode: (id: string) => InternalNode | undefined;
}) {
  const drop = getCanvasConnectionDropNode(root, point);
  if (
    !drop ||
    drop.hit.closest(
      '.react-flow__handle, .react-flow__resize-control, button, .react-flow__panel, [role="toolbar"]',
    )
  )
    return null;
  const node = getNode(drop.nodeId);
  if (!node) return null;
  const connectableHandles = Array.from(
    drop.nodeElement.querySelectorAll<HTMLElement>(
      ".react-flow__handle.connectable.connectableend",
    ),
  );
  const handles = [
    ...(node.internals.handleBounds?.source ?? []),
    ...(node.internals.handleBounds?.target ?? []),
  ].filter((handle) =>
    connectableHandles.some(
      (element) =>
        element.classList.contains(handle.type) &&
        (element.dataset.handleid || null) === (handle.id ?? null),
    ),
  );
  const target = getCanvasBodyConnectionTarget(
    fromNode,
    fromHandle,
    node,
    handles,
  );
  return target ? { ...target, nodeElement: drop.nodeElement } : null;
}
