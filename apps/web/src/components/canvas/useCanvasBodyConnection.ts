import { useCallback } from "react";
import { useStoreApi, type Connection, type OnConnectEnd } from "@xyflow/react";
import {
  getCanvasConnectionDropNode,
  resolveCanvasBodyConnection,
} from "./canvasBodyConnection";

export function useCanvasBodyConnection({
  onConnect,
  onConnectEnd,
}: {
  onConnect: (connection: Connection) => void;
  onConnectEnd: OnConnectEnd;
}) {
  const store = useStoreApi();
  return useCallback<OnConnectEnd>(
    (event, state) => {
      // A native handle connection has already called onConnect. Never add it twice.
      if (state.isValid || !state.fromNode || !state.fromHandle) {
        onConnectEnd(event, state);
        return;
      }
      const pointer =
        "changedTouches" in event ? event.changedTouches[0] : event;
      if (!pointer) {
        onConnectEnd(event, state);
        return;
      }
      const point = { x: pointer.clientX, y: pointer.clientY };
      const { domNode: root, nodeLookup, isValidConnection } = store.getState();
      const fromNode = nodeLookup.get(state.fromNode.id);
      const target =
        fromNode &&
        resolveCanvasBodyConnection({
          root,
          point,
          fromNode,
          fromHandle: state.fromHandle,
          getNode: (id) => nodeLookup.get(id),
        });
      if (
        target &&
        (!isValidConnection || isValidConnection(target.connection))
      ) {
        onConnect(target.connection);
        onConnectEnd(event, {
          ...state,
          isValid: true,
          toNode: target.node,
          toHandle: target.handle,
          toPosition: target.handle.position,
        });
        return;
      }
      // Dropping on an incompatible node must not open the empty-canvas menu.
      const drop = getCanvasConnectionDropNode(root, point);
      onConnectEnd(event, {
        ...state,
        toNode: (drop && nodeLookup.get(drop.nodeId)) || state.toNode,
      });
    },
    [onConnect, onConnectEnd, store],
  );
}
