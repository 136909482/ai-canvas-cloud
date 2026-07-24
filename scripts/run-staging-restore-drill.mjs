import { spawn } from "node:child_process";

const compose = [
  "compose",
  "--env-file",
  "infra/deploy/staging/staging.env",
  "-f",
  "infra/deploy/staging/docker-compose.yml",
  "--profile",
  "restore",
];

async function docker(args) {
  await new Promise((resolve, reject) => {
    const child = spawn("docker", [...compose, ...args], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", () =>
      reject(new Error("Docker Compose could not start")),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Docker Compose failed with exit code ${code ?? "unknown"}`,
            ),
          ),
    );
  });
}

try {
  await docker([
    "up",
    "-d",
    "restore-postgres",
    "restore-redis",
    "restore-object-storage",
    "backup-storage",
  ]);
  await docker([
    "run",
    "--rm",
    "-e",
    "SOURCE_GUARD_MODE=record",
    "source-guard",
  ]);
  await docker(["run", "--rm", "restore-drill"]);
  await docker([
    "run",
    "--rm",
    "-e",
    "SOURCE_GUARD_MODE=verify",
    "source-guard",
  ]);
  console.log(JSON.stringify({ event: "staging_restore_drill_verified" }));
} catch (error) {
  console.error(
    JSON.stringify({
      event: "staging_restore_drill_runner_failed",
      error: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
}
