import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export const ANONYMOUS_ENTRY_LIMIT_BYTES = 200 * 1024;
export const WEB_FONT_LIMIT_BYTES = 256 * 1024;
const WEB_FONT_EXTENSIONS = /\.(?:otf|ttf|woff2?)$/i;
export const FORBIDDEN_ENTRY_CHUNKS = [
  "authenticatedapp",
  "app-toolbar",
  "vendor-editor",
  "vendor-flow",
  "vendor-panorama",
  "vendor-three",
];

function attributes(source) {
  return new Map(
    [
      ...source.matchAll(
        /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
      ),
    ].map((match) => [
      match[1].toLowerCase(),
      match[2] ?? match[3] ?? match[4] ?? "",
    ]),
  );
}

export function getAnonymousEntryReferences(html) {
  const references = new Set();

  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const tagName = match[1].toLowerCase();
    const values = attributes(match[2]);
    if (tagName === "script" && values.get("type") === "module") {
      const source = values.get("src");
      if (source) references.add(source);
      continue;
    }

    if (tagName === "link") {
      const relation = values.get("rel")?.toLowerCase();
      const href = values.get("href");
      if ((relation === "modulepreload" || relation === "stylesheet") && href) {
        references.add(href);
      }
    }
  }

  return [...references];
}

function resolveLocalReference(distDirectory, reference) {
  const url = new URL(reference, "https://anonymous-entry.invalid/");
  if (url.origin !== "https://anonymous-entry.invalid") {
    throw new Error(
      `Anonymous entry references an external resource: ${url.origin}${url.pathname}`,
    );
  }

  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const absolutePath = resolve(distDirectory, relativePath);
  const absoluteRoot = `${resolve(distDirectory)}${sep}`;
  if (!absolutePath.startsWith(absoluteRoot)) {
    throw new Error(`Anonymous entry resource escapes dist: ${url.pathname}`);
  }
  return { absolutePath, pathname: url.pathname };
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

export function inspectWebFonts(
  distDirectory,
  { limitBytes = WEB_FONT_LIMIT_BYTES } = {},
) {
  const absoluteDist = resolve(distDirectory);
  const resources = listFiles(absoluteDist)
    .filter((path) => WEB_FONT_EXTENSIONS.test(path))
    .map((path) => ({
      pathname: path.slice(absoluteDist.length).split(sep).join("/"),
      bytes: statSync(path).size,
    }));
  const bytes = resources.reduce(
    (total, resource) => total + resource.bytes,
    0,
  );

  if (bytes > limitBytes) {
    throw new Error(
      `Web fonts total ${(bytes / 1024).toFixed(2)} KiB; limit is ${(limitBytes / 1024).toFixed(0)} KiB. Use system fonts or subsetted WOFF2 assets.`,
    );
  }

  return { bytes, limitBytes, resources };
}

export function inspectAnonymousEntry(
  distDirectory,
  { limitBytes = ANONYMOUS_ENTRY_LIMIT_BYTES } = {},
) {
  const absoluteDist = resolve(distDirectory);
  const indexPath = resolve(absoluteDist, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Web build is missing index.html: ${indexPath}`);
  }

  const html = readFileSync(indexPath, "utf8");
  const references = getAnonymousEntryReferences(html);
  const forbidden = references.filter((reference) =>
    FORBIDDEN_ENTRY_CHUNKS.some((chunkName) =>
      reference.toLowerCase().includes(chunkName),
    ),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `Anonymous index.html preloads authenticated chunks: ${forbidden.join(", ")}`,
    );
  }

  const resources = references
    .map((reference) => resolveLocalReference(absoluteDist, reference))
    .filter(({ pathname }) => /\.(?:css|js)$/i.test(pathname))
    .map(({ absolutePath, pathname }) => {
      if (!existsSync(absolutePath)) {
        throw new Error(`Anonymous entry resource is missing: ${pathname}`);
      }
      return {
        pathname,
        gzipBytes: gzipSync(readFileSync(absolutePath)).byteLength,
      };
    });
  const gzipBytes = resources.reduce(
    (total, resource) => total + resource.gzipBytes,
    0,
  );

  if (gzipBytes > limitBytes) {
    throw new Error(
      `Anonymous entry is ${(gzipBytes / 1024).toFixed(2)} KiB gzip; limit is ${(limitBytes / 1024).toFixed(2)} KiB.`,
    );
  }

  return {
    gzipBytes,
    limitBytes,
    resources,
    webFonts: inspectWebFonts(absoluteDist),
  };
}

function isMainModule() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  try {
    const result = inspectAnonymousEntry(process.argv[2] ?? "apps/web/dist");
    console.log(
      `Anonymous entry: ${(result.gzipBytes / 1024).toFixed(2)} KiB gzip / ${(result.limitBytes / 1024).toFixed(0)} KiB limit (${result.resources.length} JS/CSS files); web fonts ${(result.webFonts.bytes / 1024).toFixed(2)} KiB / ${(result.webFonts.limitBytes / 1024).toFixed(0)} KiB limit.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
