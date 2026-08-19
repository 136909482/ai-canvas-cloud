import { readMediaUrlAsBlob } from "@/utils/mediaDataUrl";

const PLANNING_IMAGE_MAX_EDGE = 1536;
const PLANNING_IMAGE_JPEG_QUALITY = 0.82;

export function resolvePlanningImageSize(
  width: number,
  height: number,
  maxEdge = PLANNING_IMAGE_MAX_EDGE,
) {
  const safeWidth =
    Number.isFinite(width) && width > 0 ? Math.max(1, Math.round(width)) : 1;
  const safeHeight =
    Number.isFinite(height) && height > 0 ? Math.max(1, Math.round(height)) : 1;
  const scale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight));

  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function loadPlanningImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();

    const release = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      release();
      resolve(image);
    };
    image.onerror = () => {
      release();
      reject(new Error("规划图片解码失败"));
    };
    image.src = objectUrl;
  });
}

export async function createInlinePlanningImage(imageUrl: string) {
  const blob = await readMediaUrlAsBlob(imageUrl, "规划图片读取失败");
  const image = await loadPlanningImage(blob);
  const size = resolvePlanningImageSize(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  );
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("规划图片处理失败");
  }

  context.drawImage(image, 0, 0, size.width, size.height);

  try {
    return canvas.toDataURL("image/jpeg", PLANNING_IMAGE_JPEG_QUALITY);
  } catch (error) {
    throw new Error("规划图片编码失败", { cause: error });
  }
}
