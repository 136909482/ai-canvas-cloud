export interface LoadImageEditorSourceOptions<T> {
  imageUrl: string;
  relativePath?: string | null;
  resolveAssetUrl: (relativePath: string) => Promise<string>;
  clearAssetUrlCache: () => void;
  load: (imageUrl: string) => Promise<T>;
}

export interface LoadedImageEditorSource<T> {
  imageUrl: string;
  value: T;
}

export async function loadImageEditorSource<T>({
  imageUrl,
  relativePath,
  resolveAssetUrl,
  clearAssetUrlCache,
  load,
}: LoadImageEditorSourceOptions<T>): Promise<LoadedImageEditorSource<T>> {
  let initialImageUrl = imageUrl;

  if (relativePath) {
    try {
      initialImageUrl = await resolveAssetUrl(relativePath);
    } catch {
      // The URL stored on the node may still be usable while refresh is unavailable.
    }
  }

  try {
    return {
      imageUrl: initialImageUrl,
      value: await load(initialImageUrl),
    };
  } catch (initialError) {
    if (!relativePath) {
      throw initialError;
    }

    clearAssetUrlCache();
    const refreshedImageUrl = await resolveAssetUrl(relativePath);
    return {
      imageUrl: refreshedImageUrl,
      value: await load(refreshedImageUrl),
    };
  }
}
