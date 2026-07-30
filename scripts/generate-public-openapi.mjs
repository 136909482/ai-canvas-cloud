import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { closeApiServer } from "../apps/api/dist/server.js";
import { createFastifyApiServer } from "../apps/api/dist/fastify/server.js";

const config = {
  env: "development",
  httpAdapter: "fastify",
  logLevel: "error",
  host: "127.0.0.1",
  port: 0,
  trustProxy: false,
  shutdownTimeoutMs: 1_000,
  betterAuthUrl: "http://127.0.0.1",
  betterAuthSecret: "openapi-build-secret-that-is-long-enough",
  webPublicUrl: "http://localhost:5173",
  webAllowedOrigins: ["http://localhost:5173"],
  databaseUrl: "postgres://openapi.invalid/cloud",
  redisUrl: "redis://openapi.invalid/0",
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
  devSeedAdmin: false,
  devSeedAdminUsername: "admin_user",
  devSeedAdminEmail: "admin@example.com",
  authEmailTransport: "development",
  smtpSecure: false,
  smtpCredentialActiveKeyVersion: 1,
};
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const server = await createFastifyApiServer({ config });

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
    "public OpenAPI endpoint must be available",
  );
  const document = await response.json();
  const operationIds = [];

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
    }
  }
  assert(operationIds.length > 0, "public OpenAPI contains no operations");
  assert.equal(
    new Set(operationIds).size,
    operationIds.length,
    "public OpenAPI operationId values must be unique",
  );

  const destination = resolve(
    workspaceRoot,
    "apps/api/dist/openapi/public.json",
  );
  await mkdir(resolve(workspaceRoot, "apps/api/dist/openapi"), {
    recursive: true,
  });
  await writeFile(
    destination,
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
} finally {
  await closeApiServer(server, 1_000);
}
