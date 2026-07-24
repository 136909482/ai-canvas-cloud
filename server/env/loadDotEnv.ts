import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

function findDotEnvPath(startDirectory: string) {
  let currentDirectory = resolve(startDirectory);
  const root = parse(currentDirectory).root;

  while (true) {
    const envPath = join(currentDirectory, ".env");

    if (existsSync(envPath)) {
      return envPath;
    }

    if (currentDirectory === root) {
      return null;
    }

    currentDirectory = dirname(currentDirectory);
  }
}

export function loadDotEnv(cwd = process.cwd()) {
  const envPath = findDotEnvPath(cwd);

  if (!envPath) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed
      .slice(0, separatorIndex)
      .trim()
      .replace(/^\uFEFF/, "");
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    process.env[key] ??= value;
  }
}
