import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import type http from "node:http";

export interface StaticSiteOptions {
  root: string;
  contentSecurityPolicy: string;
  environment: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isProtectedEnvironment(environment: string) {
  return environment === "production" || environment === "staging";
}

function setSecurityHeaders(
  response: http.ServerResponse,
  options: StaticSiteOptions,
) {
  response.setHeader("content-security-policy", options.contentSecurityPolicy);
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-site");
  if (isProtectedEnvironment(options.environment)) {
    response.setHeader(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }
}

function sendStatus(
  response: http.ServerResponse,
  statusCode: number,
  options: StaticSiteOptions,
) {
  setSecurityHeaders(response, options);
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(statusCode === 400 ? "Bad request" : "Not found");
}

function resolveRequestPath(root: string, pathname: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined;

  const absoluteRoot = resolve(root);
  const requested = resolve(
    absoluteRoot,
    decoded === "/" ? "index.html" : `.${decoded}`,
  );
  const pathFromRoot = relative(absoluteRoot, requested);
  if (
    pathFromRoot === "" ||
    pathFromRoot.startsWith(`..${sep}`) ||
    pathFromRoot === ".." ||
    pathFromRoot.includes(`..${sep}`)
  ) {
    return undefined;
  }
  return { absoluteRoot, requested, pathFromRoot };
}

function isFile(path: string) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function shouldServeSpaFallback(pathname: string) {
  const normalized = pathname === "/" ? "" : pathname.slice(1);
  return normalized.length === 0 || extname(normalized) === "";
}

function cacheControl(pathFromRoot: string) {
  if (pathFromRoot === "index.html") return "no-store";
  if (pathFromRoot.startsWith(`assets${sep}`))
    return "public, max-age=31536000, immutable";
  return "no-cache";
}

function streamFile(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  filePath: string,
  pathFromRoot: string,
  options: StaticSiteOptions,
) {
  setSecurityHeaders(response, options);
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    CONTENT_TYPES[extname(filePath).toLowerCase()] ??
      "application/octet-stream",
  );
  response.setHeader("cache-control", cacheControl(pathFromRoot));
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!response.headersSent) sendStatus(response, 404, options);
    else response.destroy();
  });
  stream.pipe(response);
}

export function createStaticSite(options: StaticSiteOptions) {
  const indexPath = resolve(options.root, "index.html");
  if (!isFile(indexPath)) {
    throw new Error(`Static site root is missing index.html: ${options.root}`);
  }

  return {
    async handle(
      request: http.IncomingMessage,
      response: http.ServerResponse,
      pathname: string,
    ) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendStatus(response, 404, options);
        return true;
      }

      const resolved = resolveRequestPath(options.root, pathname);
      if (!resolved) {
        sendStatus(response, 400, options);
        return true;
      }

      if (isFile(resolved.requested)) {
        streamFile(
          request,
          response,
          resolved.requested,
          resolved.pathFromRoot,
          options,
        );
        return true;
      }

      if (shouldServeSpaFallback(pathname)) {
        streamFile(request, response, indexPath, "index.html", options);
        return true;
      }

      sendStatus(response, 404, options);
      return true;
    },
  };
}
