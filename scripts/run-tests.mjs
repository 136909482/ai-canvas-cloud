import { existsSync, readdirSync, statSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const TEST_ROOTS = ["apps", "packages", "server", "scripts"];
const TEST_FILE_SUFFIXES = [".test.ts", ".test.mjs"];
const TEST_BUILD_WORKSPACES = [
  "@ai-canvas-cloud/shared",
  "@ai-canvas-cloud/contracts",
  "@ai-canvas-cloud/project-graph",
  "@ai-canvas-cloud/server",
  "@ai-canvas-cloud/api",
  "@ai-canvas-cloud/admin-api",
];

function parseArguments(arguments_) {
  const options = {
    unitOnly: false,
    selectors: [],
  };

  for (const argument of arguments_) {
    if (argument === "--unit") {
      options.unitOnly = true;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown test option: ${argument}`);
    }

    options.selectors.push(argument);
  }

  return options;
}

function isTestFile(filePath) {
  return TEST_FILE_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}

function collectTestFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") {
        continue;
      }

      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (isTestFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectSelectedTestFiles(selectors) {
  if (selectors.length === 0) {
    return TEST_ROOTS.flatMap(collectTestFiles);
  }

  const workspaceRoot = resolve(process.cwd());

  return selectors.flatMap((selector) => {
    const selectedPath = resolve(selector);
    const relativePath = relative(workspaceRoot, selectedPath);

    if (
      relativePath.startsWith("..") ||
      relativePath === "" ||
      !existsSync(selectedPath)
    ) {
      throw new Error(
        `Test selector must exist inside the repository: ${selector}`,
      );
    }

    if (statSync(selectedPath).isDirectory()) {
      return collectTestFiles(selectedPath);
    }

    if (!isTestFile(normalize(selectedPath))) {
      throw new Error(
        `Test selector is not a supported test file: ${selector}`,
      );
    }

    return [selectedPath];
  });
}

let options;

try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid test arguments.",
  );
  process.exit(1);
}

let testFiles;

try {
  testFiles = [...new Set(collectSelectedTestFiles(options.selectors))]
    .filter(
      (filePath) =>
        !options.unitOnly || !filePath.includes(".integration.test."),
    )
    .sort();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid test selector.",
  );
  process.exit(1);
}

if (testFiles.length === 0) {
  console.error("No matching test files found.");
  process.exit(1);
}

console.log(
  `Building ${TEST_BUILD_WORKSPACES.length} workspaces required by the test runtime.`,
);

const packageBuild = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "run",
    "build",
    ...TEST_BUILD_WORKSPACES.flatMap((workspace) => ["-w", workspace]),
  ],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (packageBuild.status !== 0) {
  process.exit(packageBuild.status ?? 1);
}

console.log(
  `Running ${testFiles.length} ${options.unitOnly ? "unit " : ""}test files with Node test runner.`,
);

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  {
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
