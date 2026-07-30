import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createUnavailableAdminService } from "../server/dist/modules/admin/index.js";
import { closeAdminApiServer } from "../apps/admin-api/dist/server.js";
import { createFastifyAdminApiServer } from "../apps/admin-api/dist/fastify/server.js";
import {
  ADMIN_ROUTE_INVENTORY,
  adminOpenApiPath,
} from "../apps/admin-api/dist/routeInventory.js";

const config = {
  env: "development",
  httpAdapter: "fastify",
  host: "127.0.0.1",
  port: 0,
  logLevel: "error",
  shutdownTimeoutMs: 1_000,
  trustProxy: false,
  databaseUrl: "postgres://admin_openapi.invalid/cloud",
  betterAuthUrl: "http://127.0.0.1",
  betterAuthSecret: "admin-openapi-secret-that-is-long-enough",
  webPublicUrl: "http://localhost:5174",
  allowedOrigins: ["http://localhost:5174"],
  objectStorageEnvironmentFallback: false,
  s3Endpoint: "",
  s3PublicEndpoint: "",
  s3PublicOrigin: "",
  s3ForcePathStyle: true,
  s3Bucket: "",
  s3Region: "",
  s3AccessKeyId: "",
  s3SecretAccessKey: "",
  objectStorageCredentialActiveKeyVersion: 1,
  assetMaintenanceApiUrl: "http://127.0.0.1:8787",
  smtpCredentialActiveKeyVersion: 1,
  smtpSecure: false,
};

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createFastifyAdminApiServer({
  config,
  adminService: createUnavailableAdminService(),
  logger,
});

try {
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/docs/json`);
  assert.equal(
    response.status,
    200,
    "Admin OpenAPI endpoint must be available",
  );
  const document = await response.json();
  const operationIds = [];
  const documentedRoutes = new Map();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation || typeof operation !== "object") continue;
      assert.equal(
        typeof operation.operationId,
        "string",
        `${method.toUpperCase()} ${path} is missing operationId`,
      );
      assert(
        operation.responses && Object.keys(operation.responses).length > 0,
        `${method.toUpperCase()} ${path} is missing response schemas`,
      );
      operationIds.push(operation.operationId);
      documentedRoutes.set(
        `${method.toUpperCase()} ${path}`,
        operation.operationId,
      );
    }
  }
  assert.equal(
    new Set(operationIds).size,
    operationIds.length,
    "Admin OpenAPI operationId values must be unique",
  );
  const expectedRoutes = new Map(
    ADMIN_ROUTE_INVENTORY.map((route) => [
      `${route.method} ${adminOpenApiPath(route.path)}`,
      route.operationId,
    ]),
  );
  assert.deepEqual(
    [...documentedRoutes].sort(([left], [right]) => left.localeCompare(right)),
    [...expectedRoutes].sort(([left], [right]) => left.localeCompare(right)),
    "Admin OpenAPI routes must exactly match the route inventory",
  );

  const destination = resolve(
    workspaceRoot,
    "apps/admin-api/dist/openapi/admin.json",
  );
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
} finally {
  await closeAdminApiServer(server, 1_000);
}
