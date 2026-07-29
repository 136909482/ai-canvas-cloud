import { readdirSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PREWARM_CONCURRENCY = 4;
export const PREWARM_TIMEOUT_MS = 15_000;
export const PREWARM_RETRIES = 2;

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

export function listAssetPaths(distDirectory) {
  const assetsDirectory = resolve(distDirectory, "assets");
  return listFiles(assetsDirectory)
    .map(
      (filePath) =>
        `/assets/${relative(assetsDirectory, filePath).split(sep).join("/")}`,
    )
    .sort();
}

function siteTargets(site) {
  const publicUrl = new URL(site.publicUrl);
  if (publicUrl.username || publicUrl.password) {
    throw new Error(`${site.name} public URL must not contain credentials.`);
  }
  publicUrl.search = "";
  publicUrl.hash = "";

  return {
    html: { site: site.name, url: publicUrl },
    assets: listAssetPaths(site.distDirectory).map((pathname) => ({
      site: site.name,
      url: new URL(pathname, publicUrl.origin),
    })),
  };
}

async function requestTarget(
  target,
  { fetchImpl, logger, retries, retryDelayMs, timeoutMs },
) {
  const attempts = retries + 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status = "error";

    try {
      const response = await fetchImpl(target.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      status = String(response.status);
      await response.arrayBuffer();

      if (response.ok) {
        logger.info(
          `[prewarm] ${target.url.host} ${target.url.pathname} status=${status} attempt=${attempt}/${attempts}`,
        );
        return { ok: true, site: target.site, pathname: target.url.pathname };
      }
    } catch {
      status = "error";
    } finally {
      clearTimeout(timer);
    }

    logger.warn(
      `[prewarm] ${target.url.host} ${target.url.pathname} status=${status} attempt=${attempt}/${attempts}`,
    );
    if (attempt < attempts && retryDelayMs > 0) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, retryDelayMs),
      );
    }
  }

  return { ok: false, site: target.site, pathname: target.url.pathname };
}

async function runQueue(targets, concurrency, request) {
  const results = new Array(targets.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < targets.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await request(targets[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () =>
      worker(),
    ),
  );
  return results;
}

export async function prewarmStaticAssets({
  sites,
  concurrency = PREWARM_CONCURRENCY,
  timeoutMs = PREWARM_TIMEOUT_MS,
  retries = PREWARM_RETRIES,
  retryDelayMs = 250,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Prewarm concurrency must be a positive integer.");
  }

  const targets = sites.map(siteTargets);
  const request = (target) =>
    requestTarget(target, {
      fetchImpl,
      logger,
      retries,
      retryDelayMs,
      timeoutMs,
    });

  const htmlResults = await runQueue(
    targets.map((target) => target.html),
    concurrency,
    request,
  );
  const assetResults = await runQueue(
    targets.flatMap((target) => target.assets),
    concurrency,
    request,
  );
  const results = [...htmlResults, ...assetResults];
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;

  logger.info(
    `[prewarm] summary succeeded=${succeeded} failed=${failed} total=${results.length}`,
  );
  return { succeeded, failed, total: results.length, results };
}

function isMainModule() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  try {
    await prewarmStaticAssets({
      sites: [
        {
          name: "public",
          publicUrl: process.env.WEB_PUBLIC_URL,
          distDirectory: "/app/apps/web/dist",
        },
        {
          name: "admin",
          publicUrl: process.env.ADMIN_WEB_PUBLIC_URL,
          distDirectory: "/app/apps/admin-web/dist",
        },
      ],
    });
  } catch (error) {
    console.error("[prewarm] setup failed; static prewarm was not completed.");
    if (process.env.NODE_ENV !== "production") {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
