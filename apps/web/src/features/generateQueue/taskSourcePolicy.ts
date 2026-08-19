import type { GenerateTask } from "@/types";

export function isSupportedTaskSourceNodeType(
  kind: GenerateTask["kind"],
  nodeType: string | undefined,
) {
  if (kind === "video") {
    return nodeType === "videoGenerateNode";
  }

  return (
    nodeType === "generateNode" ||
    nodeType === "imageEditNode" ||
    nodeType === "entourageNode"
  );
}
