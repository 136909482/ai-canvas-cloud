import type { WorkspaceImageAsset } from "@/types";

export type ReferenceImageItem = {
  sourceId: string;
  imageUrl: string;
  thumbnailRelativePath?: string;
  assetRelativePath?: string;
};

const REFERENCE_IMAGE_KEY_SEPARATOR = "\u0000";

export function encodeReferenceImageKey(item: ReferenceImageItem) {
  return [
    item.sourceId,
    item.imageUrl,
    item.thumbnailRelativePath ?? "",
    item.assetRelativePath ?? "",
  ].join(REFERENCE_IMAGE_KEY_SEPARATOR);
}

export function decodeReferenceImageKey(
  key: string,
): ReferenceImageItem | null {
  const fields = key.split(REFERENCE_IMAGE_KEY_SEPARATOR);
  if (fields.length !== 4) return null;
  const [
    sourceId = "",
    imageUrl = "",
    thumbnailRelativePath = "",
    assetRelativePath = "",
  ] = fields;
  if (!sourceId || !imageUrl) {
    return null;
  }

  return {
    sourceId,
    imageUrl,
    thumbnailRelativePath: thumbnailRelativePath || undefined,
    assetRelativePath: assetRelativePath || undefined,
  };
}

export function buildReferenceImageAsset(
  item: ReferenceImageItem,
): WorkspaceImageAsset | null {
  return item.thumbnailRelativePath
    ? {
        relativePath: "",
        mimeType: "",
        fileName: "",
        thumbnailRelativePath: item.thumbnailRelativePath,
      }
    : null;
}

export function getReferenceOrderLabel(order: number) {
  return String(order);
}
