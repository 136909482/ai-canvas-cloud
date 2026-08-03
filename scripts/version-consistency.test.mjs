import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

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

test("application version stays consistent across workspaces and release metadata", async () => {
  const rootPackage = await readJson(join(workspaceRoot, "package.json"));
  assert.match(rootPackage.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

  const workspacePaths = await workspaceDirectories(
    rootPackage.workspaces ?? [],
  );
  const packagePaths = ["", ...workspacePaths];
  const packages = await Promise.all(
    packagePaths.map(async (workspacePath) => ({
      workspacePath,
      document: await readJson(
        join(workspaceRoot, workspacePath, "package.json"),
      ),
    })),
  );
  const internalNames = new Set(packages.map(({ document }) => document.name));

  for (const packageEntry of packages) {
    assert.equal(
      packageEntry.document.version,
      rootPackage.version,
      `${packageEntry.workspacePath || "root"} has a different version`,
    );
    for (const field of dependencyFields) {
      for (const [name, version] of Object.entries(
        packageEntry.document[field] ?? {},
      )) {
        if (internalNames.has(name)) {
          assert.equal(
            version,
            rootPackage.version,
            `${packageEntry.workspacePath || "root"} depends on ${name}@${version}`,
          );
        }
      }
    }
  }

  const lock = await readJson(join(workspaceRoot, "package-lock.json"));
  assert.equal(lock.version, rootPackage.version);
  for (const packageEntry of packages) {
    const lockEntry = lock.packages?.[packageEntry.workspacePath];
    assert.ok(
      lockEntry,
      `package-lock is missing ${packageEntry.workspacePath || "root"}`,
    );
    assert.equal(lockEntry.version, rootPackage.version);
    for (const field of dependencyFields) {
      for (const [name, version] of Object.entries(lockEntry[field] ?? {})) {
        if (internalNames.has(name)) assert.equal(version, rootPackage.version);
      }
    }
  }

  const changelog = await readFile(join(workspaceRoot, "CHANGELOG.md"), "utf8");
  assert.match(
    changelog,
    new RegExp(
      `^## \\[${rootPackage.version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`,
      "m",
    ),
  );
});
