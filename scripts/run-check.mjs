import { existsSync } from "node:fs";
import { extname } from "node:path";
import { spawnSync } from "node:child_process";

const eslintExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const npmExecPath = process.env.npm_execpath;

if (!npmExecPath) {
  console.error("Run this check through `npm run check`.");
  process.exit(1);
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: options.capture ? "utf8" : undefined,
    shell: options.shell ?? false,
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    if (options.capture && result.stderr) {
      console.error(result.stderr.trim());
    }
    process.exit(result.status ?? 1);
  }

  return options.capture ? result.stdout : "";
}

function runNpm(arguments_) {
  run(process.execPath, [npmExecPath, ...arguments_]);
}

function readGitPaths(arguments_) {
  return run("git", arguments_, { capture: true })
    .split(/\r?\n/)
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

const changedFiles = [
  ...new Set([
    ...readGitPaths(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
    ...readGitPaths(["ls-files", "--others", "--exclude-standard"]),
  ]),
]
  .filter((filePath) => existsSync(filePath))
  .sort();

const lintFiles = changedFiles.filter((filePath) =>
  eslintExtensions.has(extname(filePath)),
);

runNpm(["run", "test:unit"]);

if (lintFiles.length > 0) {
  console.log(`Linting ${lintFiles.length} changed source file(s).`);
  runNpm(["run", "lint:files", "--", ...lintFiles]);
} else {
  console.log("No changed JavaScript or TypeScript files to lint.");
}

if (changedFiles.length > 0) {
  console.log(
    `Checking formatting for ${changedFiles.length} changed file(s).`,
  );
  runNpm(["run", "format:files", "--", ...changedFiles]);
} else {
  console.log("No changed files to format-check.");
}

runNpm(["run", "typecheck"]);
