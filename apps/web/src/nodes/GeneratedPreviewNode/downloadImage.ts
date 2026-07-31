export interface DownloadPreviewImageOptions<T> {
  imageUrl: string;
  relativePath?: string | null;
  resolveAssetUrl: (relativePath: string) => Promise<string>;
  clearAssetUrlCache: () => void;
  download: (imageUrl: string) => Promise<T>;
}

export async function downloadPreviewImage<T>({
  imageUrl,
  relativePath,
  resolveAssetUrl,
  clearAssetUrlCache,
  download,
}: DownloadPreviewImageOptions<T>): Promise<T> {
  if (!relativePath) {
    return download(imageUrl);
  }

  const initialUrl = await resolveAssetUrl(relativePath);

  try {
    return await download(initialUrl);
  } catch {
    clearAssetUrlCache();
    const refreshedUrl = await resolveAssetUrl(relativePath);
    return download(refreshedUrl);
  }
}
