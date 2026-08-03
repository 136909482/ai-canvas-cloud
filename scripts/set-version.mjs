import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedVersion = process.argv[2]?.replace(/^v/, "");
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

if (
  !requestedVersion ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedVersion)
) {
  throw new Error("Usage: npm run version:set -- <semver>");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function workspaceDirectories(patterns) {
  const directories = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) {
      directories.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    const entries = await readdir(join(workspaceRoot, parent), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(`${parent}/${entry.name}`);
    }
  }
  return directories.sort();
}

const rootPackagePath = join(workspaceRoot, "package.json");
const rootPackage = await readJson(rootPackagePath);
const workspacePaths = await workspaceDirectories(rootPackage.workspaces ?? []);
const packagePaths = ["", ...workspacePaths];
const packages = await Promise.all(
  packagePaths.map(async (workspacePath) => ({
    workspacePath,
    path: join(workspaceRoot, workspacePath, "package.json"),
    document: await readJson(
      join(workspaceRoot, workspacePath, "package.json"),
    ),
  })),
);
const internalNames = new Set(packages.map(({ document }) => document.name));

for (const packageEntry of packages) {
  packageEntry.document.version = requestedVersion;
  for (const field of dependencyFields) {
    const dependencies = packageEntry.document[field];
    if (!dependencies) continue;
    for (const dependencyName of Object.keys(dependencies)) {
      if (internalNames.has(dependencyName)) {
        dependencies[dependencyName] = requestedVersion;
      }
    }
  }
  await writeFile(
    packageEntry.path,
    `${JSON.stringify(packageEntry.document, null, 2)}\n`,
    "utf8",
  );
}

const lockPath = join(workspaceRoot, "package-lock.json");
const lock = await readJson(lockPath);
lock.version = requestedVersion;
for (const packageEntry of packages) {
  const lockEntry = lock.packages?.[packageEntry.workspacePath];
  if (!lockEntry) {
    throw new Error(
      `Missing package-lock entry: ${packageEntry.workspacePath || "."}`,
    );
  }
  lockEntry.version = requestedVersion;
  for (const field of dependencyFields) {
    const dependencies = lockEntry[field];
    if (!dependencies) continue;
    for (const dependencyName of Object.keys(dependencies)) {
      if (internalNames.has(dependencyName)) {
        dependencies[dependencyName] = requestedVersion;
      }
    }
  }
}
await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

console.log(
  `Updated ${packages.length} packages and package-lock.json to ${requestedVersion}.`,
);
