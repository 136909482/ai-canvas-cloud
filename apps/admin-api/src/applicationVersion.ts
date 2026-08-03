import { readFileSync } from "node:fs";

interface PackageMetadata {
  version?: unknown;
}

const packageMetadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageMetadata;

if (typeof packageMetadata.version !== "string" || !packageMetadata.version) {
  throw new Error("Admin API package version is missing");
}

export const APPLICATION_VERSION = packageMetadata.version;
