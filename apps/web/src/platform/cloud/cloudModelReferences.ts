import type { Node } from "@xyflow/react";
import type { CanvasSnapshot } from "@/types";
import { isLocalModelReference } from "@/features/settings/localModelReferences";

const MODEL_NODE_TYPES = new Set([
  "imageNode",
  "videoNode",
  "generateNode",
  "imageEditNode",
  "entourageNode",
  "interiorRefurnishNode",
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
  "providerProfileId",
  "providerProtocol",
  "protocol",
  "authMode",
  "customManifest",
  "customManifestId",
  "providerManifestId",
  "providerManifestVersion",
  "providerBindingFingerprint",
  "executionMode",
  "taskPhase",
  "endpoint",
  "apiUrl",
  "apiKey",
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
      for (const field of [
        "model",
        "plannerModel",
        "recognitionModel",
      ] as const) {
        const modelId =
          typeof data[field] === "string" ? data[field].trim() : "";
        if (modelId)
          data[field] = isLocalModelReference(modelId)
            ? modelId
            : ensureReference(modelId);
      }

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
      let changed = false;
      for (const field of [
        "model",
        "plannerModel",
        "recognitionModel",
      ] as const) {
        const reference =
          typeof data[field] === "string" ? data[field].trim() : "";
        if (isLocalModelReference(reference)) {
          data[field] = resolveReference(reference) ?? reference;
          changed = true;
        }
      }
      return changed ? cloneNodeWithData(node, data) : node;
    }),
    edges: snapshot.edges,
  };
}
