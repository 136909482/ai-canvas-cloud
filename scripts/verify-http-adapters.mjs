import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import {
  createAdminBetterAuthApi,
  createAssetCleanupService,
  createDevelopmentAuthEmailService,
  createManagedS3ObjectStorage,
  createObjectStorageCredentialKeyring,
  createPostgresAdminDashboardService,
  createPostgresAdminService,
  createPostgresAdminUserOperationsService,
  createPostgresAssetMaintenanceService,
  createPostgresAssetService,
  createPostgresAuthService,
  createPostgresGenerationTelemetryService,
  createPostgresMigrationAssetUploadService,
  createPostgresMigrationExportService,
  createPostgresMigrationImportService,
  createPostgresPool,
  createPostgresProjectGraphService,
  createPostgresProjectService,
  createPostgresProjectSnapshotService,
  createPostgresPublicSiteConfigService,
  createPostgresWorkspaceUsageService,
  createWorkspaceAuthorizationService,
  loadDotEnv,
} from "../server/dist/index.js";
import {
  createJsonLogger,
  createMetricsRegistry,
} from "../packages/shared/dist/index.js";
import { loadApiConfig } from "../apps/api/dist/config.js";
import { createRedisRateLimiter } from "../apps/api/dist/rateLimit.js";
import { closeApiServer, createApiServer } from "../apps/api/dist/server.js";
import { createFastifyApiServer } from "../apps/api/dist/fastify/server.js";
import { loadAdminApiConfig } from "../apps/admin-api/dist/config.js";
import {
  closeAdminApiServer,
  createAdminApiServer,
} from "../apps/admin-api/dist/server.js";
import { createFastifyAdminApiServer } from "../apps/admin-api/dist/fastify/server.js";

loadDotEnv();

const childMode = process.argv.includes("--child");
const scriptPath = fileURLToPath(import.meta.url);
const runId = randomUUID().replaceAll("-", "");
const benchmarkConcurrencies = (
  process.env.ADAPTER_BENCH_CONCURRENCY ?? "25,100,250"
)
  .split(",")
  .map(Number);
const warmupSeconds = Number(process.env.ADAPTER_BENCH_WARMUP_SECONDS ?? 15);
const durationSeconds = Number(
  process.env.ADAPTER_BENCH_DURATION_SECONDS ?? 60,
);
const repetitions = Number(process.env.ADAPTER_BENCH_REPETITIONS ?? 3);
const enforcePerformanceThresholds =
  process.env.ADAPTER_BENCH_ENFORCE_THRESHOLDS !== "false";
const logger = createJsonLogger({ level: "error", service: "adapter-verify" });
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function assertBenchmarkOptions() {
  assert(
    benchmarkConcurrencies.length > 0 &&
      benchmarkConcurrencies.every(
        (value) => Number.isInteger(value) && value > 0,
      ),
    "ADAPTER_BENCH_CONCURRENCY must contain positive integers",
  );
  for (const [name, value] of [
    ["ADAPTER_BENCH_WARMUP_SECONDS", warmupSeconds],
    ["ADAPTER_BENCH_DURATION_SECONDS", durationSeconds],
    ["ADAPTER_BENCH_REPETITIONS", repetitions],
  ]) {
    assert(Number.isInteger(value) && value > 0, `${name} must be positive`);
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function createPublicRuntime() {
  const config = loadApiConfig(process.env);
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
  });
  const authorizationService = createWorkspaceAuthorizationService(pool);
  const metrics = createMetricsRegistry();
  const objectStorage = createManagedS3ObjectStorage(pool, {
    keyring: createObjectStorageCredentialKeyring({
      serializedKeys: config.objectStorageCredentialKeys,
      activeVersion: config.objectStorageCredentialActiveKeyVersion,
      developmentSecret: config.betterAuthSecret,
    }),
    fallback: config.objectStorageEnvironmentFallback
      ? {
          endpoint: config.s3Endpoint,
          publicEndpoint: config.s3PublicEndpoint,
          bucket: config.s3Bucket,
          region: config.s3Region,
          accessKeyId: config.s3AccessKeyId,
          secretAccessKey: config.s3SecretAccessKey,
          forcePathStyle: config.s3ForcePathStyle,
        }
      : undefined,
  });
  const siteConfigService = createPostgresPublicSiteConfigService(
    pool,
    objectStorage,
  );
  const authService = createPostgresAuthService(pool, {
    baseURL: config.betterAuthUrl,
    secret: config.betterAuthSecret,
    publicWebUrl: config.webPublicUrl,
    trustedOrigins: config.webAllowedOrigins,
    environment: config.env,
    emailService: createDevelopmentAuthEmailService({
      env: config.env,
      logger: silentLogger,
    }),
    registrationEmailVerificationRequired: async () => false,
  });
  const assetService = createPostgresAssetService(pool, {
    authorizationService,
    objectStorage,
  });
  const assetCleanupService = createAssetCleanupService(
    createPostgresAssetMaintenanceService(pool, objectStorage),
  );
  const projectGraphService = createPostgresProjectGraphService(pool, {
    authorizationService,
  });
  const projectSnapshotService = createPostgresProjectSnapshotService(pool, {
    authorizationService,
  });
  const projectService = createPostgresProjectService(pool, {
    authorizationService,
  });
  const rateLimiter =
    process.env.BENCH_RATE_LIMIT === "true"
      ? createRedisRateLimiter(
          config.redisUrl,
          process.env.BENCH_RATE_LIMIT_NAMESPACE ?? config.env,
        )
      : undefined;
  const options = {
    config,
    logger,
    metrics,
    authService,
    assetService,
    assetCleanupService,
    projectGraphService,
    projectSnapshotService,
    projectService,
    siteConfigService,
    workspaceUsageService: createPostgresWorkspaceUsageService(pool, {
      authorizationService,
    }),
    generationTelemetryService: createPostgresGenerationTelemetryService(pool, {
      authorizationService,
    }),
    migrationImportService: createPostgresMigrationImportService(pool, {
      authorizationService,
    }),
    migrationAssetUploadService: createPostgresMigrationAssetUploadService(
      pool,
      objectStorage,
      { authorizationService },
    ),
    migrationExportService: createPostgresMigrationExportService(
      pool,
      objectStorage,
      { authorizationService },
    ),
    rateLimiter,
  };
  const server =
    config.httpAdapter === "fastify"
      ? await createFastifyApiServer(options)
      : createApiServer(options);
  return {
    server,
    async close() {
      await closeApiServer(server, 10_000);
      await rateLimiter?.close();
      objectStorage.destroy();
      await pool.end();
    },
  };
}

async function createAdminRuntime() {
  const config = loadAdminApiConfig(process.env);
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    schema: "admin",
    max: config.databasePoolMax,
  });
  const adminService = createPostgresAdminService(pool, {
    baseURL: config.betterAuthUrl,
    secret: config.betterAuthSecret,
    trustedOrigins: config.allowedOrigins,
    environment: config.env,
  });
  const userOperationsService = createPostgresAdminUserOperationsService(pool, {
    adminService,
    auditSecret: config.betterAuthSecret,
    ordinaryAuthSecret: config.ordinaryAuthSecret,
  });
  const dashboardService = createPostgresAdminDashboardService(pool, {
    adminService,
    readInfrastructureHealth: async () => ({
      postgres: { status: "healthy", latencyMs: 0 },
      objectStorage: { status: "healthy", latencyMs: 0 },
    }),
  });
  const options = {
    config,
    logger,
    adminService,
    userOperationsService,
    dashboardService,
  };
  const server =
    config.httpAdapter === "fastify"
      ? await createFastifyAdminApiServer(options)
      : createAdminApiServer(options);
  return {
    server,
    async close() {
      await closeAdminApiServer(server, 10_000);
      await pool.end();
    },
  };
}

async function runChild() {
  const service = process.env.BENCH_SERVICE;
  const port = Number(process.env.BENCH_PORT);
  assert(service === "api" || service === "admin-api");
  assert(Number.isInteger(port) && port > 0);
  const runtime =
    service === "api"
      ? await createPublicRuntime()
      : await createAdminRuntime();
  await listen(runtime.server, port);
  process.stdout.write("READY\n");
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await runtime.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

function jsonRequest(url, options = {}) {
  const parsed = new URL(url);
  const bodyText =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? "GET",
        agent: options.agent,
        headers: {
          ...(options.headers ?? {}),
          ...(bodyText === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(bodyText),
              }),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = null;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          }
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body,
          });
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(options.timeoutMs ?? 120_000, () => {
      request.destroy(
        new Error(
          `HTTP ${options.method ?? "GET"} ${parsed.pathname} timed out`,
        ),
      );
    });
    if (bodyText !== undefined) request.write(bodyText);
    request.end();
  });
}

function cookieHeader(headers) {
  return (headers["set-cookie"] ?? [])
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function childEnvironment(service, adapter, port, options = {}) {
  return {
    ...process.env,
    NODE_ENV: process.env.ADAPTER_BENCH_NODE_ENV ?? "test",
    LOG_LEVEL: "error",
    BENCH_SERVICE: service,
    BENCH_PORT: String(port),
    BENCH_RATE_LIMIT: options.rateLimit ? "true" : "false",
    BENCH_RATE_LIMIT_NAMESPACE: options.rateLimitNamespace ?? "",
    API_HTTP_ADAPTER: adapter,
    ADMIN_API_HTTP_ADAPTER: adapter,
    API_PORT: String(port),
    ADMIN_API_PORT: String(port),
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    ADMIN_BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    ...(options.databaseUrl
      ? {
          DATABASE_URL: options.databaseUrl,
          ADMIN_DATABASE_URL: options.databaseUrl,
        }
      : {}),
    API_INSTANCE_COUNT: String(options.instanceCount ?? 1),
    ADMIN_API_INSTANCE_COUNT: String(options.instanceCount ?? 1),
  };
}

function startChild(service, adapter, port, options = {}) {
  const child = spawn(process.execPath, [scriptPath, "--child"], {
    cwd: process.cwd(),
    env: childEnvironment(service, adapter, port, options),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-8_000);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`${service} ${adapter} startup timed out`)),
      30_000,
    );
    const poll = setInterval(() => {
      if (stdout.includes("READY")) {
        clearInterval(poll);
        clearTimeout(deadline);
        resolve();
      }
      if (child.exitCode !== null) {
        clearInterval(poll);
        clearTimeout(deadline);
        reject(
          new Error(
            `${service} ${adapter} exited before ready: ${stderr || stdout}`,
          ),
        );
      }
    }, 25);
  });
  return {
    child,
    ready,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Child shutdown timed out")),
            15_000,
          ),
        ),
      ]);
    },
  };
}

async function createBenchmarkAccounts(identity, databaseUrl) {
  const databaseEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ADMIN_DATABASE_URL: databaseUrl,
  };
  const apiConfig = loadApiConfig(databaseEnvironment);
  const publicPool = createPostgresPool({
    connectionString: apiConfig.databaseUrl,
    max: 2,
  });
  const publicAuth = createPostgresAuthService(publicPool, {
    baseURL: "http://127.0.0.1:18787",
    secret: apiConfig.betterAuthSecret,
    publicWebUrl: apiConfig.webPublicUrl,
    trustedOrigins: apiConfig.webAllowedOrigins,
    environment: "development",
    emailService: createDevelopmentAuthEmailService({
      env: "development",
      logger: silentLogger,
    }),
    registrationEmailVerificationRequired: async () => false,
  });
  const registered = await publicAuth.register(
    {
      username: identity.publicUsername,
      email: identity.publicEmail,
      password: identity.publicPassword,
      acceptedTermsAndPrivacy: true,
    },
    { requestId: `bench-register-${runId}` },
  );
  await publicPool.query(
    `UPDATE "user" SET email_verified = TRUE WHERE id = $1`,
    [registered.response.user.id],
  );
  const workspace = await publicPool.query(
    `SELECT id::text FROM workspaces WHERE owner_user_id = $1 AND type = 'personal'`,
    [registered.response.user.id],
  );
  assert.equal(workspace.rowCount, 1);
  const writeProjects = Array.from(
    { length: Math.max(...benchmarkConcurrencies) },
    (_, workerId) => ({
      id: randomUUID(),
      name: `Adapter write ${workerId}`,
      version: 0,
      sequence: 0,
    }),
  );
  await publicPool.query(
    `
      INSERT INTO projects (id, workspace_id, name)
      SELECT project_id, $1::uuid, project_name
      FROM unnest($2::uuid[], $3::text[]) AS fixture(project_id, project_name)
    `,
    [
      workspace.rows[0].id,
      writeProjects.map((project) => project.id),
      writeProjects.map((project) => project.name),
    ],
  );

  const adminConfig = loadAdminApiConfig(databaseEnvironment);
  const adminPool = createPostgresPool({
    connectionString: adminConfig.databaseUrl,
    schema: "admin",
    max: 2,
  });
  const adminAuthOptions = {
    baseURL: "http://127.0.0.1:18788",
    secret: adminConfig.betterAuthSecret,
    trustedOrigins: adminConfig.allowedOrigins,
    environment: "development",
  };
  const adminAuth = createAdminBetterAuthApi(adminPool, adminAuthOptions);
  const adminRegistered = await adminAuth.signUpEmail({
    body: {
      email: `${identity.adminUsername}@admin.invalid`,
      password: identity.adminPassword,
      name: identity.adminUsername,
      username: identity.adminUsername,
      displayUsername: identity.adminUsername,
      rememberMe: false,
    },
    returnHeaders: true,
  });
  await adminPool.query(
    `UPDATE "user" SET role = 'super_admin', status = 'active', email_verified = TRUE WHERE id = $1`,
    [adminRegistered.response.user.id],
  );
  await adminPool.query('DELETE FROM "session" WHERE user_id = $1', [
    adminRegistered.response.user.id,
  ]);
  const captcha = await adminPool.query(
    `SELECT captcha_enabled FROM login_security_settings WHERE singleton_id = 1`,
  );
  await adminPool.query(
    `UPDATE login_security_settings SET captcha_enabled = false, updated_by_admin_id = NULL WHERE singleton_id = 1`,
  );
  await Promise.all([publicPool.end(), adminPool.end()]);
  return {
    publicUserId: registered.response.user.id,
    adminUserId: adminRegistered.response.user.id,
    captchaEnabled: Boolean(captcha.rows[0]?.captcha_enabled),
    writeProjects,
  };
}

async function loginAndPrepare(
  apiPort,
  adminPort,
  identity,
  existing,
  writeProjects,
) {
  const publicLogin = await jsonRequest(
    `http://127.0.0.1:${apiPort}/api/v1/auth/login`,
    {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
      body: {
        identifier: identity.publicEmail,
        password: identity.publicPassword,
        deviceId: `bench-${runId}`,
        force: true,
      },
    },
  );
  assert.equal(publicLogin.statusCode, 200, "Public benchmark login failed");
  const publicCookie = cookieHeader(publicLogin.headers);
  assert(publicCookie);

  const adminCsrf = await jsonRequest(
    `http://127.0.0.1:${adminPort}/admin/v1/auth/csrf`,
    { headers: { origin: "http://localhost:5174" } },
  );
  assert.equal(adminCsrf.statusCode, 200, "Admin CSRF preparation failed");
  assert.equal(typeof adminCsrf.body?.token, "string");
  const adminCsrfCookie = cookieHeader(adminCsrf.headers);
  assert(adminCsrfCookie);
  const adminLogin = await jsonRequest(
    `http://127.0.0.1:${adminPort}/admin/v1/auth/login`,
    {
      method: "POST",
      headers: {
        origin: "http://localhost:5174",
        cookie: adminCsrfCookie,
        "x-csrf-token": adminCsrf.body.token,
      },
      body: {
        username: identity.adminUsername,
        password: identity.adminPassword,
      },
    },
  );
  assert.equal(
    adminLogin.statusCode,
    200,
    `Admin benchmark login failed: ${JSON.stringify(adminLogin.body)}`,
  );
  const adminCookie = cookieHeader(adminLogin.headers);
  assert(adminCookie);

  if (existing) {
    return {
      ...existing,
      publicCookie,
      adminCookie,
    };
  }

  const projectId = randomUUID();
  const createdProject = await jsonRequest(
    `http://127.0.0.1:${apiPort}/api/v1/projects`,
    {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        cookie: publicCookie,
      },
      body: { id: projectId, name: "Adapter benchmark" },
    },
  );
  assert.equal(
    createdProject.statusCode,
    201,
    "Benchmark project creation failed",
  );
  const upload = await jsonRequest(
    `http://127.0.0.1:${apiPort}/api/v1/assets/uploads`,
    {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        cookie: publicCookie,
      },
      body: {
        projectId,
        originalFileName: "adapter-benchmark.png",
        mimeType: "image/png",
        byteSize: 68,
        assetKind: "upload",
        idempotencyKey: `asset-${runId}`,
      },
    },
  );
  assert.equal(upload.statusCode, 201, "Benchmark asset preparation failed");
  const assetBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  assert.equal(assetBytes.length, 68);
  const uploadedAsset = await uploadBytes(
    upload.body.directUpload.url,
    upload.body.directUpload.headers,
    assetBytes,
  );
  assert(
    uploadedAsset.statusCode >= 200 && uploadedAsset.statusCode < 300,
    "Benchmark asset object upload failed",
  );
  const completedAsset = await jsonRequest(
    `http://127.0.0.1:${apiPort}/api/v1/assets/uploads/${upload.body.upload.id}/complete`,
    {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        cookie: publicCookie,
      },
    },
  );
  assert.equal(
    completedAsset.statusCode,
    200,
    "Benchmark asset completion failed",
  );
  const assetId = upload.body.asset.id;
  const graphBody = {
    baseVersion: 0,
    clientId: `client-${runId}`,
    batchId: `batch-${runId}`,
    idempotencyKey: `graph-${runId}`,
    operations: [
      {
        type: "upsertNode",
        node: {
          id: `node-${runId}`,
          nodeType: "text",
          position: { x: 0, y: 0 },
          dataSchemaVersion: 1,
          data: { text: "adapter benchmark" },
        },
      },
    ],
  };
  const graph = await jsonRequest(
    `http://127.0.0.1:${apiPort}/api/v1/projects/${projectId}/graph`,
    {
      method: "PATCH",
      headers: {
        origin: "http://localhost:5173",
        cookie: publicCookie,
      },
      body: graphBody,
    },
  );
  assert.equal(graph.statusCode, 200, "Benchmark graph preparation failed");
  return {
    publicCookie,
    adminCookie,
    projectId,
    assetId,
    graphBody,
    writeProjects: writeProjects.map((project) => ({ ...project })),
  };
}

function benchmarkRequests(apiPort, adminPort, state) {
  const publicHeaders = {
    cookie: state.publicCookie,
    origin: "http://localhost:5173",
  };
  return [
    {
      name: "public-session",
      url: `http://127.0.0.1:${apiPort}/api/v1/auth/session`,
      headers: publicHeaders,
    },
    {
      name: "project-list",
      url: `http://127.0.0.1:${apiPort}/api/v1/projects?limit=20`,
      headers: publicHeaders,
    },
    {
      name: "project-detail",
      url: `http://127.0.0.1:${apiPort}/api/v1/projects/${state.projectId}`,
      headers: publicHeaders,
    },
    {
      name: "project-graph-read",
      url: `http://127.0.0.1:${apiPort}/api/v1/projects/${state.projectId}/graph`,
      headers: publicHeaders,
    },
    {
      name: "project-graph-write",
      create(workerId) {
        const project = state.writeProjects[workerId];
        const sequence = ++project.sequence;
        return {
          url: `http://127.0.0.1:${apiPort}/api/v1/projects/${project.id}/graph`,
          method: "PATCH",
          headers: publicHeaders,
          body: {
            baseVersion: project.version,
            clientId: `bench-worker-${workerId}`,
            batchId: `bench-batch-${runId}-${workerId}-${sequence}`,
            idempotencyKey: `bench-write-${runId}-${workerId}-${sequence}`,
            operations: [
              {
                type: "upsertNode",
                node: {
                  id: `bench-node-${workerId}`,
                  nodeType: "text",
                  position: { x: sequence, y: workerId },
                  dataSchemaVersion: 1,
                  data: { text: `adapter benchmark ${sequence}` },
                },
              },
            ],
          },
          accepted(response) {
            if (response.statusCode === 200) {
              project.version = response.body.version;
            }
          },
        };
      },
    },
    {
      name: "asset-metadata",
      url: `http://127.0.0.1:${apiPort}/api/v1/assets/${state.assetId}`,
      headers: publicHeaders,
    },
    {
      name: "admin-user-list",
      url: `http://127.0.0.1:${adminPort}/admin/v1/users?limit=20`,
      headers: {
        cookie: state.adminCookie,
        origin: "http://localhost:5174",
      },
    },
  ];
}

async function runLoad(requests, concurrency, seconds, collect) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const latencies = [];
  const statuses = new Map();
  const requestCounts = new Map();
  const unexpectedSamples = [];
  const transportErrorSamples = [];
  let completed = 0;
  let failed = 0;
  const startedAt = performance.now();
  const deadline = startedAt + seconds * 1_000;
  async function worker(workerId) {
    let cursor = workerId % requests.length;
    while (performance.now() < deadline) {
      const descriptor = requests[cursor];
      cursor = (cursor + 1) % requests.length;
      const request = descriptor.create
        ? descriptor.create(workerId)
        : descriptor;
      requestCounts.set(
        descriptor.name,
        (requestCounts.get(descriptor.name) ?? 0) + 1,
      );
      const requestStartedAt = performance.now();
      try {
        const response = await jsonRequest(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          agent,
          timeoutMs: 30_000,
        });
        statuses.set(
          response.statusCode,
          (statuses.get(response.statusCode) ?? 0) + 1,
        );
        if (
          (response.statusCode < 200 || response.statusCode >= 300) &&
          unexpectedSamples.length < 3
        ) {
          unexpectedSamples.push({
            statusCode: response.statusCode,
            request: descriptor.name,
            path: new URL(request.url).pathname,
          });
        }
        request.accepted?.(response);
      } catch (error) {
        failed += 1;
        if (transportErrorSamples.length < 3) {
          transportErrorSamples.push({
            request: descriptor.name,
            path: new URL(request.url).pathname,
            code:
              error && typeof error === "object" && "code" in error
                ? String(error.code)
                : "UNKNOWN",
            elapsedMs: Number(
              (performance.now() - requestStartedAt).toFixed(2),
            ),
          });
        }
      }
      if (collect) latencies.push(performance.now() - requestStartedAt);
      completed += 1;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, id) => worker(id)));
  agent.destroy();
  const elapsedSeconds = (performance.now() - startedAt) / 1_000;
  latencies.sort((left, right) => left - right);
  const p95 = collect
    ? latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)]
    : 0;
  return {
    throughput: completed / elapsedSeconds,
    p95,
    failed,
    statuses: Object.fromEntries(statuses),
    requestCounts: Object.fromEntries(requestCounts),
    unexpectedSamples,
    transportErrorSamples,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarizeBenchmarkRuns(runs) {
  return {
    throughput: median(runs.map((run) => run.throughput)),
    p95: median(runs.map((run) => run.p95)),
    unexpected5xx: runs.reduce(
      (sum, run) =>
        sum +
        Object.entries(run.statuses).reduce(
          (count, [status, occurrences]) =>
            count + (Number(status) >= 500 ? occurrences : 0),
          0,
        ) +
        run.failed,
      0,
    ),
    unexpectedNon2xx: runs.reduce(
      (sum, run) =>
        sum +
        Object.entries(run.statuses).reduce(
          (count, [status, occurrences]) =>
            count +
            (Number(status) < 200 || Number(status) >= 300 ? occurrences : 0),
          0,
        ),
      0,
    ),
  };
}

async function runPairedAdapterBenchmark(
  identity,
  databases,
  legacyWriteProjects,
  fastifyWriteProjects,
) {
  const adapters = {
    legacy: {
      apiPort: 18787,
      adminPort: 18788,
      databaseUrl: databases.legacyUrl,
      writeProjects: legacyWriteProjects,
    },
    fastify: {
      apiPort: 28787,
      adminPort: 28788,
      databaseUrl: databases.fastifyUrl,
      writeProjects: fastifyWriteProjects,
    },
  };
  const children = Object.entries(adapters).flatMap(([adapter, options]) => [
    startChild("api", adapter, options.apiPort, {
      databaseUrl: options.databaseUrl,
      instanceCount: 2,
    }),
    startChild("admin-api", adapter, options.adminPort, {
      databaseUrl: options.databaseUrl,
      instanceCount: 2,
    }),
  ]);
  await Promise.all(children.map((child) => child.ready));
  try {
    for (const [adapter, options] of Object.entries(adapters)) {
      options.state = await loginAndPrepare(
        options.apiPort,
        options.adminPort,
        identity,
        undefined,
        options.writeProjects,
      );
      options.requests = benchmarkRequests(
        options.apiPort,
        options.adminPort,
        options.state,
      );
      options.runs = Object.fromEntries(
        benchmarkConcurrencies.map((concurrency) => [concurrency, []]),
      );
      console.log(JSON.stringify({ phase: "adapter-ready", adapter }));
    }

    for (const [
      concurrencyIndex,
      concurrency,
    ] of benchmarkConcurrencies.entries()) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const legacyFirst = (concurrencyIndex + repetition) % 2 === 1;
        const order = legacyFirst
          ? ["legacy", "fastify"]
          : ["fastify", "legacy"];
        for (const adapter of order) {
          const options = adapters[adapter];
          await stabilizeBenchmarkDatabase(
            databases.controlPool,
            `${adapter}-${concurrency}-${repetition}`,
          );
          await runLoad(options.requests, concurrency, warmupSeconds, false);
          const measured = await runLoad(
            options.requests,
            concurrency,
            durationSeconds,
            true,
          );
          options.runs[concurrency].push(measured);
          console.log(
            JSON.stringify({
              phase: "performance",
              adapter,
              concurrency,
              repetition,
              order,
              throughput: Number(measured.throughput.toFixed(2)),
              p95Ms: Number(measured.p95.toFixed(2)),
              statuses: measured.statuses,
              requestCounts: measured.requestCounts,
              unexpectedSamples: measured.unexpectedSamples,
              transportErrors: measured.failed,
              transportErrorSamples: measured.transportErrorSamples,
            }),
          );
        }
      }
    }

    return {
      states: Object.fromEntries(
        Object.entries(adapters).map(([adapter, options]) => [
          adapter,
          options.state,
        ]),
      ),
      results: Object.fromEntries(
        Object.entries(adapters).map(([adapter, options]) => [
          adapter,
          Object.fromEntries(
            benchmarkConcurrencies.map((concurrency) => [
              concurrency,
              summarizeBenchmarkRuns(options.runs[concurrency]),
            ]),
          ),
        ]),
      ),
    };
  } finally {
    await Promise.all(children.map((child) => child.stop()));
  }
}

function comparePerformance(legacy, fastify) {
  const comparisons = [];
  for (const concurrency of benchmarkConcurrencies) {
    const before = legacy[concurrency];
    const after = fastify[concurrency];
    const throughputRatio = after.throughput / before.throughput;
    const p95Ratio = after.p95 / before.p95;
    const correct =
      before.unexpected5xx === 0 &&
      after.unexpected5xx === 0 &&
      before.unexpectedNon2xx === 0 &&
      after.unexpectedNon2xx === 0;
    const performanceAccepted = throughputRatio >= 0.95 && p95Ratio <= 1.1;
    const accepted =
      correct && (performanceAccepted || !enforcePerformanceThresholds);
    comparisons.push({
      concurrency,
      legacyThroughput: Number(before.throughput.toFixed(2)),
      fastifyThroughput: Number(after.throughput.toFixed(2)),
      throughputRatio: Number(throughputRatio.toFixed(4)),
      legacyP95Ms: Number(before.p95.toFixed(2)),
      fastifyP95Ms: Number(after.p95.toFixed(2)),
      p95Ratio: Number(p95Ratio.toFixed(4)),
      performanceAccepted,
      accepted,
    });
  }
  console.log(
    JSON.stringify({
      phase: "performance-summary",
      thresholdsEnforced: enforcePerformanceThresholds,
      comparisons,
    }),
  );
  assert(
    comparisons.every(
      (comparison) =>
        legacy[comparison.concurrency].unexpected5xx === 0 &&
        legacy[comparison.concurrency].unexpectedNon2xx === 0,
    ),
    "Legacy baseline emitted errors; the benchmark environment is invalid",
  );
  assert(
    comparisons.every((comparison) => comparison.accepted),
    "Fastify performance acceptance thresholds were not met",
  );
}

function createRoundRobinProxy(upstreams) {
  let cursor = 0;
  const server = http.createServer((incoming, outgoing) => {
    const target = upstreams[cursor++ % upstreams.length];
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: target,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.statusCode = 502;
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  return server;
}

async function uploadBytes(url, headers, bytes) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: "PUT",
        headers: { ...headers, "content-length": bytes.length },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve({ statusCode: response.statusCode ?? 0 }),
        );
      },
    );
    request.on("error", reject);
    request.end(bytes);
  });
}

async function clearRateLimitKeys(namespace) {
  const client = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await client.connect();
    let cursor = "0";
    do {
      const [next, keys] = await client.scan(
        cursor,
        "MATCH",
        `ai-canvas:${namespace}:ratelimit:*`,
        "COUNT",
        500,
      );
      cursor = next;
      if (keys.length > 0) await client.unlink(...keys);
    } while (cursor !== "0");
  } finally {
    client.disconnect();
  }
}

async function runMultiInstanceAcceptance(identity, prepared, databaseUrl) {
  const namespace = `adapter-multi-${runId}`;
  const apiPorts = [38787, 38789];
  const adminPorts = [38788, 38790];
  const children = [
    ...apiPorts.map((port) =>
      startChild("api", "fastify", port, {
        rateLimit: true,
        rateLimitNamespace: namespace,
        instanceCount: 2,
        databaseUrl,
      }),
    ),
    ...adminPorts.map((port) =>
      startChild("admin-api", "fastify", port, {
        instanceCount: 2,
        databaseUrl,
      }),
    ),
  ];
  await Promise.all(children.map((child) => child.ready));
  let publicProxy;
  let adminProxy;
  try {
    const state = await loginAndPrepare(
      apiPorts[0],
      adminPorts[0],
      identity,
      prepared,
    );
    publicProxy = createRoundRobinProxy(apiPorts);
    adminProxy = createRoundRobinProxy(adminPorts);
    await Promise.all([listen(publicProxy, 39787), listen(adminProxy, 39788)]);
    for (let index = 0; index < 20; index += 1) {
      const publicSession = await jsonRequest(
        "http://127.0.0.1:39787/api/v1/auth/session",
        { headers: { cookie: state.publicCookie } },
      );
      assert.equal(publicSession.statusCode, 200);
      const adminUsers = await jsonRequest(
        "http://127.0.0.1:39788/admin/v1/users?limit=5",
        { headers: { cookie: state.adminCookie } },
      );
      assert.equal(adminUsers.statusCode, 200);
    }

    await clearRateLimitKeys(namespace);
    let rateLimited = 0;
    for (let index = 0; index < 241; index += 1) {
      const response = await jsonRequest(
        `http://127.0.0.1:${apiPorts[index % 2]}/api/v1/projects?limit=1`,
        {
          headers: {
            cookie: state.publicCookie,
            "x-forwarded-for": "198.51.100.42",
          },
        },
      );
      if (response.statusCode === 429) rateLimited += 1;
      else assert.equal(response.statusCode, 200);
    }
    assert.equal(
      rateLimited,
      1,
      "Redis rate limit was not global across instances",
    );
    await clearRateLimitKeys(namespace);

    const projectId = randomUUID();
    assert.equal(
      (
        await jsonRequest(`http://127.0.0.1:${apiPorts[0]}/api/v1/projects`, {
          method: "POST",
          headers: {
            origin: "http://localhost:5173",
            cookie: state.publicCookie,
          },
          body: { id: projectId, name: "Multi-instance acceptance" },
        })
      ).statusCode,
      201,
    );
    const graphBody = {
      baseVersion: 0,
      clientId: `multi-client-${runId}`,
      batchId: `multi-batch-${runId}`,
      idempotencyKey: `multi-idempotency-${runId}`,
      operations: [
        {
          type: "upsertNode",
          node: {
            id: `multi-node-${runId}`,
            nodeType: "text",
            position: { x: 1, y: 1 },
            dataSchemaVersion: 1,
            data: { text: "multi-instance" },
          },
        },
      ],
    };
    const graphPath = `/api/v1/projects/${projectId}/graph`;
    const idempotent = await Promise.all(
      apiPorts.map((port) =>
        jsonRequest(`http://127.0.0.1:${port}${graphPath}`, {
          method: "PATCH",
          headers: {
            origin: "http://localhost:5173",
            cookie: state.publicCookie,
          },
          body: graphBody,
        }),
      ),
    );
    assert(idempotent.every((response) => response.statusCode === 200));
    assert(idempotent.every((response) => response.body.version === 1));
    const conflict = await jsonRequest(
      `http://127.0.0.1:${apiPorts[1]}${graphPath}`,
      {
        method: "PATCH",
        headers: {
          origin: "http://localhost:5173",
          cookie: state.publicCookie,
        },
        body: {
          ...graphBody,
          batchId: `conflict-batch-${runId}`,
          idempotencyKey: `conflict-key-${runId}`,
        },
      },
    );
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.error.code, "PROJECT_VERSION_CONFLICT");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await jsonRequest(
      `http://127.0.0.1:${apiPorts[0]}/api/v1/assets/uploads`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          cookie: state.publicCookie,
        },
        body: {
          projectId,
          originalFileName: "multi-instance.png",
          mimeType: "image/png",
          byteSize: png.length,
          assetKind: "upload",
          idempotencyKey: `multi-asset-${runId}`,
        },
      },
    );
    assert.equal(upload.statusCode, 201);
    const uploaded = await uploadBytes(
      upload.body.directUpload.url,
      upload.body.directUpload.headers,
      png,
    );
    assert(uploaded.statusCode >= 200 && uploaded.statusCode < 300);
    const completed = await jsonRequest(
      `http://127.0.0.1:${apiPorts[1]}/api/v1/assets/uploads/${upload.body.upload.id}/complete`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          cookie: state.publicCookie,
        },
      },
    );
    assert.equal(completed.statusCode, 200);
    const metadata = await jsonRequest(
      `http://127.0.0.1:${apiPorts[0]}/api/v1/assets/${upload.body.asset.id}`,
      { headers: { cookie: state.publicCookie } },
    );
    assert.equal(metadata.statusCode, 200);

    await children[0].stop();
    const restarted = startChild("api", "fastify", apiPorts[0], {
      rateLimit: true,
      rateLimitNamespace: namespace,
      instanceCount: 2,
      databaseUrl,
    });
    await restarted.ready;
    children[0] = restarted;
    const sessionAfterRestart = await jsonRequest(
      `http://127.0.0.1:${apiPorts[0]}/api/v1/auth/session`,
      { headers: { cookie: state.publicCookie } },
    );
    assert.equal(sessionAfterRestart.statusCode, 200);
    console.log(
      JSON.stringify({
        phase: "multi-instance",
        publicInstances: 2,
        adminInstances: 2,
        databasePoolMaxPerInstance: 6,
        roundRobin: "passed",
        sharedSessions: "passed",
        globalRedisRateLimit: "passed",
        crossInstanceObjectStorage: "passed",
        idempotency: "passed",
        versionConflict: "passed",
        restartSessionContinuity: "passed",
      }),
    );
  } finally {
    await Promise.all(
      [publicProxy, adminProxy]
        .filter(Boolean)
        .map(
          (server) => new Promise((resolve) => server.close(() => resolve())),
        ),
    );
    await Promise.all(
      children.map((child) => child.stop().catch(() => undefined)),
    );
    await clearRateLimitKeys(namespace).catch(() => undefined);
  }
}

function databaseUrlForName(connectionString, databaseName) {
  assert(/^[a-z][a-z0-9_]+$/.test(databaseName));
  const parsed = new URL(connectionString);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quotedDatabaseName(databaseName) {
  assert(/^[a-z][a-z0-9_]+$/.test(databaseName));
  return `"${databaseName}"`;
}

async function runDatabaseMigrations(databaseUrl) {
  const child = spawn(process.execPath, ["scripts/apply-migrations.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MIGRATION_DATABASE_URL: databaseUrl,
      DATABASE_URL: databaseUrl,
      ADMIN_DATABASE_URL: databaseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12_000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12_000);
  });
  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 0, `Benchmark database migration failed: ${output}`);
}

async function createBenchmarkDatabases() {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  assert(migrationUrl, "MIGRATION_DATABASE_URL is required");
  const suffix = runId.slice(0, 12);
  const names = {
    baseline: `adapter_base_${suffix}`,
    legacy: `adapter_legacy_${suffix}`,
    fastify: `adapter_fastify_${suffix}`,
  };
  const controlPool = createPostgresPool({
    connectionString: databaseUrlForName(migrationUrl, "postgres"),
    max: 1,
  });
  try {
    await controlPool.query(
      `CREATE DATABASE ${quotedDatabaseName(names.baseline)}`,
    );
    const baselineUrl = databaseUrlForName(migrationUrl, names.baseline);
    await runDatabaseMigrations(baselineUrl);
    for (const databaseName of [names.legacy, names.fastify]) {
      await controlPool.query(
        `CREATE DATABASE ${quotedDatabaseName(databaseName)} TEMPLATE ${quotedDatabaseName(names.baseline)}`,
      );
    }
    return {
      controlPool,
      names,
      legacyUrl: databaseUrlForName(migrationUrl, names.legacy),
      fastifyUrl: databaseUrlForName(migrationUrl, names.fastify),
    };
  } catch (error) {
    for (const databaseName of Object.values(names).reverse()) {
      await controlPool
        .query(
          `DROP DATABASE IF EXISTS ${quotedDatabaseName(databaseName)} WITH (FORCE)`,
        )
        .catch(() => undefined);
    }
    await controlPool.end();
    throw error;
  }
}

async function stabilizeBenchmarkDatabase(controlPool, phase) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = performance.now();
    await controlPool.query("CHECKPOINT");
    const probeStartedAt = performance.now();
    await controlPool.query("SELECT 1");
    const checkpointMs = probeStartedAt - startedAt;
    console.log(
      JSON.stringify({
        phase: "database-stabilization",
        before: phase,
        attempt,
        checkpointMs: Number(checkpointMs.toFixed(2)),
        probeMs: Number((performance.now() - probeStartedAt).toFixed(2)),
      }),
    );
    if (checkpointMs <= 2_000) return;
  }
  throw new Error("PostgreSQL did not stabilize after three checkpoints");
}

async function cleanupBenchmarkObjects(databaseUrl, publicUserId) {
  const databaseEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ADMIN_DATABASE_URL: databaseUrl,
  };
  const config = loadApiConfig(databaseEnvironment);
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 1 });
  const storage = createManagedS3ObjectStorage(pool, {
    keyring: createObjectStorageCredentialKeyring({
      serializedKeys: config.objectStorageCredentialKeys,
      activeVersion: config.objectStorageCredentialActiveKeyVersion,
      developmentSecret: config.betterAuthSecret,
    }),
    fallback: config.objectStorageEnvironmentFallback
      ? {
          endpoint: config.s3Endpoint,
          publicEndpoint: config.s3PublicEndpoint,
          bucket: config.s3Bucket,
          region: config.s3Region,
          accessKeyId: config.s3AccessKeyId,
          secretAccessKey: config.s3SecretAccessKey,
          forcePathStyle: config.s3ForcePathStyle,
        }
      : undefined,
  });
  try {
    const result = await pool.query(
      `SELECT object_key FROM assets WHERE created_by_user_id = $1`,
      [publicUserId],
    );
    await Promise.all(
      result.rows.map((row) => storage.deleteObject(row.object_key)),
    );
  } finally {
    storage.destroy();
    await pool.end();
  }
}

async function dropBenchmarkDatabases(databases) {
  for (const databaseName of Object.values(databases.names).reverse()) {
    await databases.controlPool.query(
      `DROP DATABASE IF EXISTS ${quotedDatabaseName(databaseName)} WITH (FORCE)`,
    );
  }
  await databases.controlPool.end();
}

async function main() {
  assertBenchmarkOptions();
  const suffix = runId.slice(0, 12);
  const identity = {
    publicUsername: `bench_${suffix}`,
    publicEmail: `adapter-bench-${suffix}@example.invalid`,
    publicPassword: `Bench-Public-${suffix}!9aA`,
    adminUsername: `benchadm_${suffix}`,
    adminPassword: `Bench-Admin-${suffix}!9aA`,
  };
  const databases = await createBenchmarkDatabases();
  let legacyAccounts;
  let fastifyAccounts;
  try {
    legacyAccounts = await createBenchmarkAccounts(
      identity,
      databases.legacyUrl,
    );
    fastifyAccounts = await createBenchmarkAccounts(
      identity,
      databases.fastifyUrl,
    );
    const benchmark = await runPairedAdapterBenchmark(
      identity,
      databases,
      legacyAccounts.writeProjects,
      fastifyAccounts.writeProjects,
    );
    comparePerformance(benchmark.results.legacy, benchmark.results.fastify);
    await runMultiInstanceAcceptance(
      identity,
      benchmark.states.fastify,
      databases.fastifyUrl,
    );
    console.log(JSON.stringify({ accepted: true }));
  } finally {
    await Promise.allSettled([
      legacyAccounts
        ? cleanupBenchmarkObjects(
            databases.legacyUrl,
            legacyAccounts.publicUserId,
          )
        : Promise.resolve(),
      fastifyAccounts
        ? cleanupBenchmarkObjects(
            databases.fastifyUrl,
            fastifyAccounts.publicUserId,
          )
        : Promise.resolve(),
    ]);
    await dropBenchmarkDatabases(databases);
  }
}

if (childMode) await runChild();
else await main();
