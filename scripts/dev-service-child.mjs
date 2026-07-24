import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./dev-process.mjs";

const service = process.argv[2];
if (service !== "api" && service !== "admin-api") {
  throw new Error("Managed service child must be api or admin-api");
}

process.on("message", (message) => {
  if (message?.type === "stop") process.emit("SIGTERM", "SIGTERM");
});

await import(
  pathToFileURL(join(REPO_ROOT, "apps", service, "src", "index.ts")).href
);
