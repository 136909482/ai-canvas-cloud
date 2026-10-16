import { downloadMediaAsBlob } from "@/api/image/shared";
import { platformBridge } from "@/platform";
import type { WorkspaceImageAsset } from "@/types";
import { buildDownloadFileName } from "./downloadFileName";
import { downloadPreviewImage } from "./downloadPreviewImage";

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function inferMimeType(url: string) {
  if (url.startsWith("data:")) {
    return url.slice(5, url.indexOf(";")) || "image/png";
  }
  const normalizedUrl = url.toLowerCase();
  if (normalizedUrl.endsWith(".jpg") || normalizedUrl.endsWith(".jpeg"))
    return "image/jpeg";
  if (normalizedUrl.endsWith(".webp")) return "image/webp";
  if (normalizedUrl.endsWith(".gif")) return "image/gif";
  return "image/png";
}

export async function downloadCanvasImage({
  imageUrl,
  imageAsset,
}: {
  imageUrl: string;
  imageAsset?: WorkspaceImageAsset | null;
}) {
  const blob = await downloadPreviewImage({
    imageUrl,
    relativePath: imageAsset?.relativePath,
    resolveAssetUrl: (relativePath) =>
      platformBridge.resolveWorkspaceAssetUrl(relativePath),
    clearAssetUrlCache: () => platformBridge.clearWorkspaceAssetUrlCache(),
    download: (url) => downloadMediaAsBlob(url, "图片下载失败"),
  });
  const mimeType = blob.type || imageAsset?.mimeType || inferMimeType(imageUrl);
  const fileName = buildDownloadFileName({
    extension: IMAGE_MIME_EXTENSIONS[mimeType] || "png",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
