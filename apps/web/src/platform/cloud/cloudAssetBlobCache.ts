const DEFAULT_MAX_CACHE_ENTRIES = 48;
const DEFAULT_MAX_CACHE_BYTES = 96 * 1024 * 1024;

interface CachedAssetBlob {
  blob: Blob;
  byteSize: number;
}

interface CloudAssetBlobCacheOptions {
  resolveAssetUrl: (assetId: string) => Promise<string>;
  refreshAssetUrl: (assetId: string) => Promise<string>;
  fetchAsset?: (url: string) => Promise<Response>;
  maxEntries?: number;
  maxBytes?: number;
}

function validateLimit(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

async function readAssetBlob(
  url: string,
  fetchAsset: (url: string) => Promise<Response>,
) {
  const response = await fetchAsset(url);
  if (!response.ok) {
    throw new Error(`Cloud asset fetch failed: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (blob.size <= 0) {
    throw new Error("Cloud asset fetch returned an empty body");
  }
  return blob;
}

export function createCloudAssetBlobCache(options: CloudAssetBlobCacheOptions) {
  const maxEntries = validateLimit(
    options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES,
    "maxEntries",
  );
  const maxBytes = validateLimit(
    options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES,
    "maxBytes",
  );
  const fetchAsset =
    options.fetchAsset ??
    ((url: string) => fetch(url, { credentials: "omit" }));
  const cachedBlobs = new Map<string, CachedAssetBlob>();
  const inFlightLoads = new Map<string, Promise<Blob>>();
  let cachedByteSize = 0;
  let generation = 0;

  function getCached(assetId: string) {
    const cached = cachedBlobs.get(assetId);
    if (!cached) return null;

    cachedBlobs.delete(assetId);
    cachedBlobs.set(assetId, cached);
    return cached.blob;
  }

  function evictUntilWithinLimits() {
    while (cachedBlobs.size > maxEntries || cachedByteSize > maxBytes) {
      const oldestAssetId = cachedBlobs.keys().next().value;
      if (!oldestAssetId) break;
      const oldest = cachedBlobs.get(oldestAssetId);
      cachedBlobs.delete(oldestAssetId);
      cachedByteSize -= oldest?.byteSize ?? 0;
    }
  }

  function cache(assetId: string, blob: Blob) {
    if (blob.size > maxBytes) return;

    const existing = cachedBlobs.get(assetId);
    if (existing) {
      cachedByteSize -= existing.byteSize;
      cachedBlobs.delete(assetId);
    }
    cachedBlobs.set(assetId, { blob, byteSize: blob.size });
    cachedByteSize += blob.size;
    evictUntilWithinLimits();
  }

  function load(assetId: string) {
    const cached = getCached(assetId);
    if (cached) return Promise.resolve(cached);

    const inFlight = inFlightLoads.get(assetId);
    if (inFlight) return inFlight;

    const requestGeneration = generation;
    const request = options
      .resolveAssetUrl(assetId)
      .then(async (initialUrl) => {
        try {
          return await readAssetBlob(initialUrl, fetchAsset);
        } catch {
          const refreshedUrl = await options.refreshAssetUrl(assetId);
          return readAssetBlob(refreshedUrl, fetchAsset);
        }
      })
      .then((blob) => {
        if (requestGeneration !== generation) {
          throw new Error(
            "Cloud asset Blob cache was cleared while the request was in flight",
          );
        }
        cache(assetId, blob);
        return blob;
      })
      .finally(() => {
        if (inFlightLoads.get(assetId) === request) {
          inFlightLoads.delete(assetId);
        }
      });

    inFlightLoads.set(assetId, request);
    return request;
  }

  function clear() {
    generation += 1;
    cachedBlobs.clear();
    inFlightLoads.clear();
    cachedByteSize = 0;
  }

  return { load, clear };
}
