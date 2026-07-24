import type { AssetUrlResponse } from "@ai-canvas-cloud/contracts";

const CLOUD_ASSET_PATH_PREFIX = "cloud-assets/";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CLOUD_ASSET_URL_REFRESH_SKEW_MS = 30_000;

interface CachedAssetUrl {
  url: string;
  expiresAtMs: number;
}

interface CloudAssetUrlCacheOptions {
  loadAssetUrl: (assetId: string) => Promise<AssetUrlResponse>;
  now?: () => number;
  refreshSkewMs?: number;
}

function normalizeAssetPath(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function validateAssetId(assetId: string) {
  const normalized = assetId.trim().toLowerCase();

  if (!UUID_PATTERN.test(normalized)) {
    throw new Error("Cloud asset ID must be a valid UUID");
  }

  return normalized;
}

function isHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createCloudAssetRelativePath(assetId: string) {
  return `${CLOUD_ASSET_PATH_PREFIX}${validateAssetId(assetId)}`;
}

export function getCloudAssetIdFromRelativePath(relativePath: string) {
  const normalizedPath = normalizeAssetPath(relativePath);

  if (!normalizedPath.startsWith(CLOUD_ASSET_PATH_PREFIX)) {
    return null;
  }

  const assetId = normalizedPath.slice(CLOUD_ASSET_PATH_PREFIX.length);
  if (assetId.includes("/") || !UUID_PATTERN.test(assetId)) {
    return null;
  }

  return assetId.toLowerCase();
}

export function createCloudAssetUrlCache(options: CloudAssetUrlCacheOptions) {
  const now = options.now ?? Date.now;
  const refreshSkewMs =
    options.refreshSkewMs ?? CLOUD_ASSET_URL_REFRESH_SKEW_MS;
  const cachedUrls = new Map<string, CachedAssetUrl>();
  const inFlightLoads = new Map<string, Promise<string>>();
  let generation = 0;

  if (!Number.isFinite(refreshSkewMs) || refreshSkewMs < 0) {
    throw new Error("refreshSkewMs must be a non-negative finite number");
  }

  function resolve(assetId: string) {
    const normalizedAssetId = validateAssetId(assetId);
    const cached = cachedUrls.get(normalizedAssetId);

    if (cached && cached.expiresAtMs - now() > refreshSkewMs) {
      return Promise.resolve(cached.url);
    }

    const inFlight = inFlightLoads.get(normalizedAssetId);
    if (inFlight) {
      return inFlight;
    }

    const requestGeneration = generation;
    const request = options
      .loadAssetUrl(normalizedAssetId)
      .then((response) => {
        if (requestGeneration !== generation) {
          throw new Error(
            "Cloud asset URL cache was cleared while the request was in flight",
          );
        }

        if (
          typeof response.assetId !== "string" ||
          response.assetId.toLowerCase() !== normalizedAssetId
        ) {
          throw new Error(
            "Cloud asset URL response does not match the requested asset",
          );
        }

        const expiresAtMs = Date.parse(response.expiresAt);
        if (
          !isHttpUrl(response.url) ||
          !Number.isFinite(expiresAtMs) ||
          expiresAtMs <= now()
        ) {
          throw new Error(
            "Cloud asset URL response is already expired or invalid",
          );
        }

        cachedUrls.set(normalizedAssetId, {
          url: response.url,
          expiresAtMs,
        });
        return response.url;
      })
      .finally(() => {
        if (inFlightLoads.get(normalizedAssetId) === request) {
          inFlightLoads.delete(normalizedAssetId);
        }
      });

    inFlightLoads.set(normalizedAssetId, request);
    return request;
  }

  function clear() {
    generation += 1;
    cachedUrls.clear();
    inFlightLoads.clear();
  }

  return {
    resolve,
    clear,
  };
}
