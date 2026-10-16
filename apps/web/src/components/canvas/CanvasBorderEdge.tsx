import { useEffect } from "react";
import {
  BezierEdge,
  SimpleBezierEdge,
  SmoothStepEdge,
  StepEdge,
  StraightEdge,
  Position,
  ConnectionLineType,
  getBezierPath,
  getSimpleBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useStoreApi,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from "@xyflow/react";
import { getCanvasHandleBorderPoint } from "./canvasHandleGeometry";
import { resolveCanvasBodyConnection } from "./canvasBodyConnection";

const edgeRenderers = {
  default: BezierEdge,
  simplebezier: SimpleBezierEdge,
  smoothstep: SmoothStepEdge,
  step: StepEdge,
  straight: StraightEdge,
};

export function CanvasBorderEdge(props: EdgeProps) {
  // EdgeWrapper already rerenders when either endpoint moves or resizes.
  // Read its node bounds without adding subscriptions per edge.
  const { nodeLookup } = useStoreApi().getState();
  const source = getCanvasHandleBorderPoint(
    { x: props.sourceX, y: props.sourceY },
    props.sourcePosition,
    nodeLookup.get(props.source),
  );
  const target = getCanvasHandleBorderPoint(
    { x: props.targetX, y: props.targetY },
    props.targetPosition,
    nodeLookup.get(props.target),
  );
  const Renderer =
    edgeRenderers[props.type as keyof typeof edgeRenderers] ?? BezierEdge;
  return (
    <Renderer
      {...props}
      sourceX={source.x}
      sourceY={source.y}
      targetX={target.x}
      targetY={target.y}
    />
  );
}

export function CanvasBorderConnectionLine({
  fromX,
  fromY,
  fromNode,
  fromHandle,
  fromPosition,
  pointer,
  connectionLineType,
  connectionLineStyle,
}: ConnectionLineComponentProps) {
  const { domNode, nodeLookup, isValidConnection, transform } =
    useStoreApi().getState();
  const bounds = domNode?.getBoundingClientRect();
  const bodyTarget = bounds
    ? resolveCanvasBodyConnection({
        root: domNode,
        point: { x: bounds.left + pointer.x, y: bounds.top + pointer.y },
        fromNode,
        fromHandle,
        getNode: (id) => nodeLookup.get(id),
      })
    : null;
  const validBodyTarget =
    bodyTarget &&
    (!isValidConnection || isValidConnection(bodyTarget.connection))
      ? bodyTarget
      : null;
  const dropNodeElement = validBodyTarget?.nodeElement;
  useEffect(() => {
    if (!dropNodeElement) return;
    dropNodeElement.setAttribute("data-connection-drop-target", "true");
    return () => dropNodeElement.removeAttribute("data-connection-drop-target");
  }, [dropNodeElement]);
  const source = getCanvasHandleBorderPoint(
    { x: fromX, y: fromY },
    fromPosition,
    fromNode,
  );
  // The loose end always follows the pointer, including above compatible nodes.
  // Only the completed edge is anchored to the destination border.
  const target = {
    x: (pointer.x - transform[0]) / transform[2],
    y: (pointer.y - transform[1]) / transform[2],
  };
  const targetPosition = {
    left: Position.Right,
    right: Position.Left,
    top: Position.Bottom,
    bottom: Position.Top,
  }[fromPosition];
  const pathParams = {
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: fromPosition,
    targetX: target.x,
    targetY: target.y,
    targetPosition,
  };
  let path: string;
  switch (connectionLineType) {
    case ConnectionLineType.Bezier:
      [path] = getBezierPath(pathParams);
      break;
    case ConnectionLineType.SimpleBezier:
      [path] = getSimpleBezierPath(pathParams);
      break;
    case ConnectionLineType.Step:
      [path] = getSmoothStepPath({ ...pathParams, borderRadius: 0 });
      break;
    case ConnectionLineType.SmoothStep:
      [path] = getSmoothStepPath(pathParams);
      break;
    default:
      [path] = getStraightPath(pathParams);
  }
  return (
    <path
      d={path}
      fill="none"
      className="react-flow__connection-path"
      style={connectionLineStyle}
    />
  );
}
