import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateProtectedDeploymentEnvironment } from "../packages/shared/dist/index.js";

function readEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Environment file not found: ${path}`);
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    process.env[key] ??= value;
  }
}

const envFileIndex = process.argv.indexOf("--env-file");
if (envFileIndex >= 0) {
  const file = process.argv[envFileIndex + 1];
  if (!file) throw new Error("--env-file requires a path");
  readEnvFile(resolve(file));
}

validateProtectedDeploymentEnvironment(process.env);
console.log(
  `Deployment configuration accepted for ${process.env.NODE_ENV ?? "development"}`,
);
