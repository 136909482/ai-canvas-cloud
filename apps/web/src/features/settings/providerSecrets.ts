import type { WorkspaceConfigFile } from "@/types";

// Workspace config is intentionally storage-only. Private Provider data never enters this shape.
export function redactWorkspaceConfigSecretsForCache(
  config: WorkspaceConfigFile,
): WorkspaceConfigFile {
  return structuredClone(config);
}

export function redactWorkspaceConfigSecretsForExport(
  config: WorkspaceConfigFile,
): WorkspaceConfigFile {
  return structuredClone(config);
}
