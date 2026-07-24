import type { Node } from "@xyflow/react";
import type { CanvasSnapshot } from "@/types";
import { isLocalModelReference } from "@/features/settings/localModelReferences";

const MODEL_NODE_TYPES = new Set([
  "imageNode",
  "videoNode",
  "generateNode",
  "imageEditNode",
  "generatedPreviewNode",
  "videoGenerateNode",
  "llmNode",
  "llmFileNode",
  "llmOutputTextNode",
]);

const LOCAL_RUNTIME_FIELDS = [
  "activeTaskId",
  "taskId",
  "remoteTaskId",
  "remoteStatus",
  "apiProfileId",
  "apiProfileName",
  "provider",
  "providerId",
  "endpoint",
  "apiUrl",
  "apiKey",
  "generationResults",
] as const;

function cloneNodeWithData(node: Node, data: Record<string, unknown>): Node {
  return {
    ...node,
    data,
  };
}

function sanitizeRuntimeState(data: Record<string, unknown>) {
  const sanitized = { ...data };
  for (const field of LOCAL_RUNTIME_FIELDS) delete sanitized[field];

  if (
    sanitized.status === "queued" ||
    sanitized.status === "generating" ||
    sanitized.status === "running"
  ) {
    sanitized.status = "idle";
  }
  if (typeof sanitized.errorMsg === "string" && sanitized.errorMsg) {
    sanitized.errorMsg = "";
  }

  return sanitized;
}

export function prepareCanvasForCloud(
  snapshot: CanvasSnapshot,
  ensureReference: (modelId: string) => string,
): CanvasSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => {
      if (!MODEL_NODE_TYPES.has(node.type ?? "")) return node;

      const data = sanitizeRuntimeState({ ...(node.data ?? {}) });
      const modelId = typeof data.model === "string" ? data.model.trim() : "";
      if (modelId)
        data.model = isLocalModelReference(modelId)
          ? modelId
          : ensureReference(modelId);

      return cloneNodeWithData(node, data);
    }),
    edges: snapshot.edges,
  };
}

export function hydrateCanvasLocalModelReferences(
  snapshot: CanvasSnapshot,
  resolveReference: (reference: string) => string | null,
): CanvasSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => {
      if (!MODEL_NODE_TYPES.has(node.type ?? "")) return node;

      const data = { ...(node.data ?? {}) };
      const reference = typeof data.model === "string" ? data.model.trim() : "";
      if (!isLocalModelReference(reference)) return node;

      data.model = resolveReference(reference) ?? reference;
      return cloneNodeWithData(node, data);
    }),
    edges: snapshot.edges,
  };
}
