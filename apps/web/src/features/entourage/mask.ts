import type { EntouragePlacement } from "@/types";

export interface PlacementPixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_RECT_SIZE = 8;

export function buildPlacementRects(
  placements: EntouragePlacement[],
  imageWidth: number,
  imageHeight: number,
): PlacementPixelRect[] {
  const rects: PlacementPixelRect[] = [];

  for (const placement of placements) {
    const [x1, y1, x2, y2] = placement.box;
    const left = Math.round(x1 * imageWidth);
    const top = Math.round(y1 * imageHeight);
    const right = Math.round(x2 * imageWidth);
    const bottom = Math.round(y2 * imageHeight);

    const width = Math.max(MIN_RECT_SIZE, right - left);
    const height = Math.max(MIN_RECT_SIZE, bottom - top);
    const x = Math.max(0, Math.min(left, imageWidth - MIN_RECT_SIZE));
    const y = Math.max(0, Math.min(top, imageHeight - MIN_RECT_SIZE));

    rects.push({
      x,
      y,
      width: Math.min(width, imageWidth - x),
      height: Math.min(height, imageHeight - y),
    });
  }

  return rects;
}

export function drawPlacementMask(
  canvas: HTMLCanvasElement,
  rects: PlacementPixelRect[],
) {
  const context = canvas.getContext("2d");
  if (!context) return;

  canvas.width = Math.max(1, canvas.width);
  canvas.height = Math.max(1, canvas.height);
  context.clearRect(0, 0, canvas.width, canvas.height);

  // OpenAI 编辑蒙版约定：透明区域可重绘，不透明区域必须保留。
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const rect of rects) {
    context.clearRect(rect.x, rect.y, rect.width, rect.height);
  }
}

export async function createPlacementMaskDataUrl(
  imageUrl: string,
  placements: EntouragePlacement[],
): Promise<string | null> {
  if (placements.length === 0) return null;

  const imageSize = await loadImageSize(imageUrl);
  if (!imageSize) return null;

  const canvas = document.createElement("canvas");
  canvas.width = imageSize.width;
  canvas.height = imageSize.height;
  drawPlacementMask(
    canvas,
    buildPlacementRects(placements, imageSize.width, imageSize.height),
  );

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function loadImageSize(imageUrl: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
      });
    };
    image.onerror = () => resolve(null);
    image.src = imageUrl;
  });
}
