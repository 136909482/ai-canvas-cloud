interface DecodedImageSize {
  width: number;
  height: number;
  close?: () => void;
}

interface EditMaskNormalizerDependencies {
  decode: (file: Blob) => Promise<DecodedImageSize>;
  resize: (
    image: DecodedImageSize,
    width: number,
    height: number,
    mimeType: string,
    smooth: boolean,
  ) => Promise<Blob>;
}

const defaultDependencies: EditMaskNormalizerDependencies = {
  decode: (file) => createImageBitmap(file),
  resize: (image, width, height, mimeType, smooth) =>
    new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("无法创建蒙版尺寸校正画布"));
        return;
      }

      context.imageSmoothingEnabled = smooth;
      context.imageSmoothingQuality = "high";
      context.clearRect(0, 0, width, height);
      context.drawImage(image as CanvasImageSource, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("无法导出尺寸校正后的蒙版"));
      }, mimeType);
    }),
};

function parsePixelSize(size: string) {
  const matched = size.match(/^(\d+)x(\d+)$/i);
  if (!matched) return null;
  const width = Number(matched[1]);
  const height = Number(matched[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function getSourceOutputType(sourceFile: File) {
  return ["image/png", "image/jpeg", "image/webp"].includes(sourceFile.type)
    ? sourceFile.type
    : "image/png";
}

export async function normalizeEditImageFiles(
  sourceFile: File,
  maskFile: File,
  requestSize: string,
  dependencies: EditMaskNormalizerDependencies = defaultDependencies,
) {
  const [sourceImage, maskImage] = await Promise.all([
    dependencies.decode(sourceFile),
    dependencies.decode(maskFile),
  ]);

  try {
    const targetSize = parsePixelSize(requestSize) ?? {
      width: sourceImage.width,
      height: sourceImage.height,
    };
    const sourceMatches =
      sourceImage.width === targetSize.width &&
      sourceImage.height === targetSize.height;
    const maskMatches =
      maskImage.width === targetSize.width &&
      maskImage.height === targetSize.height;

    const normalizedSourceFile = sourceMatches
      ? sourceFile
      : new File(
          [
            await dependencies.resize(
              sourceImage,
              targetSize.width,
              targetSize.height,
              getSourceOutputType(sourceFile),
              true,
            ),
          ],
          sourceFile.name,
          { type: getSourceOutputType(sourceFile) },
        );

    const normalizedMaskFile = maskMatches
      ? maskFile
      : new File(
          [
            await dependencies.resize(
              maskImage,
              targetSize.width,
              targetSize.height,
              "image/png",
              false,
            ),
          ],
          "mask.png",
          { type: "image/png" },
        );

    return {
      sourceFile: normalizedSourceFile,
      maskFile: normalizedMaskFile,
    };
  } finally {
    sourceImage.close?.();
    maskImage.close?.();
  }
}
