import type { WorkspaceImageAsset } from "@/types";

export function getWorkspaceAssetRelativePath(asset: unknown) {
  if (!asset || typeof asset !== "object") {
    return undefined;
  }

  const relativePath = (asset as Partial<WorkspaceImageAsset>).relativePath;
  return typeof relativePath === "string" && relativePath
    ? relativePath
    : undefined;
}

export function getWorkspaceAssetThumbnailRelativePath(asset: unknown) {
  if (!asset || typeof asset !== "object") {
    return undefined;
  }

  const thumbnailRelativePath = (asset as Partial<WorkspaceImageAsset>)
    .thumbnailRelativePath;
  return typeof thumbnailRelativePath === "string" && thumbnailRelativePath
    ? thumbnailRelativePath
    : undefined;
}
