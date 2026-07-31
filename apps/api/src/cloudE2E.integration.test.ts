import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { createFastifyApiServer } from "../dist/fastify/server.js";
import { closeApiServer } from "../dist/serverLifecycle.js";
import {
  createPostgresAssetService,
  createPostgresAuthService,
  createPostgresMigrationAssetUploadService,
  createPostgresMigrationExportService,
  createPostgresMigrationImportService,
  createPostgresProjectGraphService,
  createPostgresProjectService,
  createPostgresProjectSnapshotService,
  createPostgresWorkspaceUsageService,
  createS3ObjectStorage,
  createWorkspaceAuthorizationService,
  isolateCurrentSchemaSql,
  loadDotEnv,
  type AuthEmailService,
} from "@ai-canvas-cloud/server";
import { createMemoryRateLimiter } from "./rateLimit.ts";
import type { ApiConfig } from "./config.ts";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3Region = process.env.S3_REGION;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

type JsonResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};

class BrowserContext {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly userAgent: string,
    private readonly deviceId: string,
  ) {}

  async request(
    port: number,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<JsonResponse> {
    const bodyText = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            origin: "http://localhost:5173",
            "user-agent": this.userAgent,
            ...(this.cookies.size > 0
              ? {
                  cookie: [...this.cookies]
                    .map(([key, value]) => `${key}=${value}`)
                    .join("; "),
                }
              : {}),
            ...(bodyText === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(bodyText),
                }),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const setCookies = response.headers["set-cookie"] ?? [];
            for (const header of setCookies) {
              const first = header.split(";", 1)[0] ?? "";
              const separator = first.indexOf("=");
              if (separator < 1) continue;
              const key = first.slice(0, separator);
              const value = first.slice(separator + 1);
              if (/max-age=0|expires=Thu, 01 Jan 1970/i.test(header))
                this.cookies.delete(key);
              else this.cookies.set(key, value);
            }
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed: unknown = null;
            if (text) {
              try {
                parsed = JSON.parse(text) as unknown;
              } catch {
                parsed = text;
              }
            }
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: response.headers,
              body: parsed,
            });
          });
        },
      );
      request.on("error", reject);
      if (bodyText !== undefined) request.write(bodyText);
      request.end();
    });
  }

  registerBody(username: string, email: string, password: string) {
    return {
      username,
      email,
      password,
      acceptedTermsAndPrivacy: true,
      deviceId: this.deviceId,
    };
  }

  loginBody(identifier: string, password: string, force = false) {
    return {
      identifier,
      password,
      deviceId: this.deviceId,
      ...(force ? { force: true } : {}),
    };
  }
}

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function createCapturedAuthEmailService() {
  let passwordResetCode = "";

  const service: AuthEmailService = {
    async sendRegistrationEmailCode() {},
    async sendPasswordResetEmail(input) {
      passwordResetCode = input.code;
    },
  };

  return {
    service,
    getPasswordResetCode: () => passwordResetCode,
  };
}

function errorCode(response: JsonResponse) {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function runCloudE2E() {
  const runId = randomUUID().replaceAll("-", "");
  const schemaName = `cloud_e2e_${runId}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  let pool: pg.Pool | undefined;
  let server: http.Server | undefined;
  let objectStorage: ReturnType<typeof createS3ObjectStorage> | undefined;

  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 6,
      options: `-c search_path=${schemaName},public`,
    });
    const migrations = (
      await readdir(join(process.cwd(), "server", "db", "migrations"))
    )
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();
    for (const fileName of migrations) {
      await pool.query(
        isolateCurrentSchemaSql(
          await readFile(
            join(process.cwd(), "server", "db", "migrations", fileName),
            "utf8",
          ),
          schemaName,
        ),
      );
    }

    objectStorage = createS3ObjectStorage({
      endpoint: s3Endpoint!,
      publicEndpoint: s3Endpoint!,
      bucket: s3Bucket!,
      region: s3Region!,
      accessKeyId: s3AccessKeyId!,
      secretAccessKey: s3SecretAccessKey!,
      forcePathStyle: true,
    });
    const authorization = createWorkspaceAuthorizationService(pool);
    const authEmailService = createCapturedAuthEmailService();
    const authService = createPostgresAuthService(pool, {
      baseURL: "http://127.0.0.1:8787",
      secret: `cloud-e2e-secret-${runId}`,
      publicWebUrl: "http://localhost:5173",
      trustedOrigins: ["http://localhost:5173"],
      environment: "test",
      emailService: authEmailService.service,
    });
    const assetService = createPostgresAssetService(pool, {
      authorizationService: authorization,
      objectStorage,
    });
    const projectService = createPostgresProjectService(pool, {
      authorizationService: authorization,
    });
    const projectGraphService = createPostgresProjectGraphService(pool, {
      authorizationService: authorization,
    });
    const projectSnapshotService = createPostgresProjectSnapshotService(pool, {
      authorizationService: authorization,
    });
    const workspaceUsageService = createPostgresWorkspaceUsageService(pool, {
      authorizationService: authorization,
    });
    const migrationImportService = createPostgresMigrationImportService(pool, {
      authorizationService: authorization,
    });
    const migrationAssetUploadService =
      createPostgresMigrationAssetUploadService(pool, objectStorage, {
        authorizationService: authorization,
      });
    const migrationExportService = createPostgresMigrationExportService(
      pool,
      objectStorage,
      { authorizationService: authorization },
    );

    const config: ApiConfig = {
      env: "test",
      logLevel: "error",
      host: "127.0.0.1",
      port: 0,
      trustProxy: false,
      shutdownTimeoutMs: 2_000,
      betterAuthUrl: "http://127.0.0.1:8787",
      betterAuthSecret: `cloud-e2e-secret-${runId}`,
      webPublicUrl: "http://localhost:5173",
      webAllowedOrigins: ["http://localhost:5173"],
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      s3Endpoint: s3Endpoint!,
      s3PublicEndpoint: s3Endpoint!,
      s3Bucket: s3Bucket!,
      s3Region: s3Region!,
      s3AccessKeyId: s3AccessKeyId!,
      s3SecretAccessKey: s3SecretAccessKey!,
      devSeedAdmin: false,
      devSeedAdminEmail: "disabled@example.invalid",
      authEmailTransport: "development",
    };

    const createServer = () => {
      const options = {
        config,
        authService,
        assetService,
        projectService,
        projectGraphService,
        projectSnapshotService,
        workspaceUsageService,
        migrationImportService,
        migrationAssetUploadService,
        migrationExportService,
        rateLimiter: createMemoryRateLimiter(),
      };
      return createFastifyApiServer(options);
    };
    server = await createServer();
    let port = await listen(server);
    const accountA = new BrowserContext(
      `cloud-e2e-a/${runId}`,
      `device-a-${runId}`,
    );
    const accountB = new BrowserContext(
      `cloud-e2e-b/${runId}`,
      `device-b-${runId}`,
    );
    const emailA = `p7-6-a-${runId}@example.invalid`;
    const emailB = `p7-6-b-${runId}@example.invalid`;
    const usernameSuffix = runId.replaceAll("-", "").slice(0, 18);
    const usernameA = `cloud_a_${usernameSuffix}`;
    const usernameB = `cloud_b_${usernameSuffix}`;
    const password = `p7-6-password-${runId}`;

    const registeredA = await accountA.request(
      port,
      "POST",
      "/api/v1/auth/register",
      accountA.registerBody(usernameA, emailA, password),
    );
    const registeredB = await accountB.request(
      port,
      "POST",
      "/api/v1/auth/register",
      accountB.registerBody(usernameB, emailB, password),
    );
    assert.equal(registeredA.statusCode, 201, JSON.stringify(registeredA.body));
    assert.equal(registeredB.statusCode, 201, JSON.stringify(registeredB.body));
    const workspaceA = (registeredA.body as { workspace: { id: string } })
      .workspace.id;
    const workspaceB = (registeredB.body as { workspace: { id: string } })
      .workspace.id;
    const userNumberA = (registeredA.body as { user: { userNumber: number } })
      .user.userNumber;
    const userNumberB = (registeredB.body as { user: { userNumber: number } })
      .user.userNumber;
    assert.notEqual(workspaceA, workspaceB);
    assert.equal(
      Number.isSafeInteger(userNumberA) && userNumberA >= 10001,
      true,
    );
    assert.equal(
      Number.isSafeInteger(userNumberB) && userNumberB >= 10001,
      true,
    );
    assert.notEqual(userNumberA, userNumberB);
    const sessionResponseA = await accountA.request(
      port,
      "GET",
      "/api/v1/auth/session",
    );
    const sessionResponseB = await accountB.request(
      port,
      "GET",
      "/api/v1/auth/session",
    );
    assert.equal(sessionResponseA.statusCode, 200);
    assert.equal(sessionResponseB.statusCode, 200);
    assert.equal(
      (sessionResponseA.body as { user: { userNumber: number } }).user
        .userNumber,
      userNumberA,
    );
    assert.equal(
      (sessionResponseB.body as { user: { userNumber: number } }).user
        .userNumber,
      userNumberB,
    );

    const createdProject = await accountA.request(
      port,
      "POST",
      "/api/v1/projects",
      { name: `P7-6 A ${runId}` },
    );
    assert.equal(createdProject.statusCode, 201);
    const projectA = (createdProject.body as { project: { id: string } })
      .project.id;
    const projectBRead = await accountB.request(
      port,
      "GET",
      `/api/v1/projects/${projectA}`,
    );
    const missingRead = await accountB.request(
      port,
      "GET",
      `/api/v1/projects/${randomUUID()}`,
    );
    assert.equal(projectBRead.statusCode, 404);
    assert.equal(missingRead.statusCode, 404);
    assert.equal(errorCode(projectBRead), errorCode(missingRead));
    assert.equal(
      (
        await accountB.request(port, "PATCH", `/api/v1/projects/${projectA}`, {
          name: "forged",
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await accountB.request(
          port,
          "POST",
          `/api/v1/projects/${projectA}/archive`,
          {},
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await accountA.request(port, "GET", `/api/v1/projects/${projectA}`))
        .statusCode,
      200,
    );

    const sourceNodeId = `source-${runId}`;
    const previewNodeId = `preview-${runId}`;
    const graphPath = `/api/v1/projects/${projectA}/graph`;
    const graphBody = (
      baseVersion: number,
      batchId: string,
      operations: unknown[],
    ) => ({
      baseVersion,
      clientId: `browser-${runId}`,
      batchId,
      idempotencyKey: `graph-${batchId}`,
      operations,
    });
    const nodes = [
      {
        id: sourceNodeId,
        nodeType: "generate",
        position: { x: 0, y: 0 },
        dataSchemaVersion: 1,
        data: {},
      },
      {
        id: previewNodeId,
        nodeType: "preview",
        position: { x: 240, y: 0 },
        dataSchemaVersion: 1,
        data: {},
      },
    ];
    const graphCreated = await accountA.request(
      port,
      "PATCH",
      graphPath,
      graphBody(
        0,
        "initial",
        nodes.map((node) => ({ type: "upsertNode", node })),
      ),
    );
    assert.equal(graphCreated.statusCode, 200);
    const graphVersion = (graphCreated.body as { version: number }).version;
    assert.equal(graphVersion, 1);
    assert.equal(
      (await accountB.request(port, "GET", graphPath)).statusCode,
      404,
    );

    const concurrent = await Promise.all([
      accountA.request(
        port,
        "PATCH",
        graphPath,
        graphBody(graphVersion, "tab-a", [
          {
            type: "upsertNode",
            node: {
              id: `tab-a-${runId}`,
              nodeType: "text",
              position: { x: 0, y: 240 },
              dataSchemaVersion: 1,
              data: {},
            },
          },
        ]),
      ),
      accountA.request(
        port,
        "PATCH",
        graphPath,
        graphBody(graphVersion, "tab-b", [
          {
            type: "upsertNode",
            node: {
              id: `tab-b-${runId}`,
              nodeType: "text",
              position: { x: 0, y: 360 },
              dataSchemaVersion: 1,
              data: {},
            },
          },
        ]),
      ),
    ]);
    assert.equal(
      concurrent.filter((response) => response.statusCode === 200).length,
      1,
    );
    assert.equal(
      concurrent.filter((response) => response.statusCode === 409).length,
      1,
    );
    const currentGraph = await accountA.request(port, "GET", graphPath);
    assert.equal(currentGraph.statusCode, 200);
    const currentVersion = (
      currentGraph.body as { version: number; sequence: number }
    ).version;
    const currentSequence = (
      currentGraph.body as { version: number; sequence: number }
    ).sequence;

    const checkpoint = await accountA.request(
      port,
      "POST",
      `/api/v1/projects/${projectA}/checkpoints`,
      {
        expectedVersion: currentVersion,
        expectedSequence: currentSequence,
      },
    );
    assert.equal(checkpoint.statusCode, 201);
    assert.equal(
      (
        await accountB.request(
          port,
          "GET",
          `/api/v1/projects/${projectA}/revisions`,
        )
      ).statusCode,
      404,
    );

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const asset = await accountA.request(
      port,
      "POST",
      "/api/v1/assets/uploads",
      {
        projectId: projectA,
        originalFileName: `p7-6-${runId}.png`,
        mimeType: "image/png",
        byteSize: png.byteLength,
        sha256: createHash("sha256").update(png).digest("hex"),
        assetKind: "upload",
        idempotencyKey: `asset-${runId}`,
      },
    );
    assert.equal(asset.statusCode, 201);
    const assetBody = asset.body as {
      asset: { id: string };
      directUpload: {
        url: string;
        method: string;
        headers: Record<string, string>;
      };
    };
    assert.equal(assetBody.directUpload.method, "PUT");
    const uploadResponse = await fetch(assetBody.directUpload.url, {
      method: "PUT",
      headers: assetBody.directUpload.headers,
      body: png,
      redirect: "error",
    });
    assert(uploadResponse.ok);
    const completedAsset = await accountA.request(
      port,
      "POST",
      `/api/v1/assets/uploads/${(asset.body as { upload: { id: string } }).upload.id}/complete`,
    );
    assert.equal(completedAsset.statusCode, 200);
    const assetId = assetBody.asset.id;
    assert.equal(
      (await accountA.request(port, "GET", `/api/v1/assets/${assetId}/url`))
        .statusCode,
      200,
    );
    const assetForbidden = await accountB.request(
      port,
      "GET",
      `/api/v1/assets/${assetId}/url`,
    );
    assert.equal(assetForbidden.statusCode, 404);
    assert.equal("url" in (assetForbidden.body as object), false);

    const sessionsA = await accountA.request(
      port,
      "GET",
      "/api/v1/auth/sessions",
    );
    const devicesA = await accountA.request(
      port,
      "GET",
      "/api/v1/auth/devices",
    );
    assert.equal(sessionsA.statusCode, 200);
    assert.equal(devicesA.statusCode, 200);
    const sessionA = (
      sessionsA.body as { sessions: Array<{ id: string }> }
    ).sessions.find((session) => session.current);
    const deviceA = (
      devicesA.body as { devices: Array<{ id: string }> }
    ).devices.find((device) => device.current);
    assert(sessionA && deviceA);
    assert.equal(
      (
        await accountB.request(
          port,
          "DELETE",
          `/api/v1/auth/sessions/${sessionA.id}`,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await accountB.request(
          port,
          "DELETE",
          `/api/v1/auth/devices/${deviceA.id}`,
        )
      ).statusCode,
      404,
    );

    await closeApiServer(server, 2_000);
    server = await createServer();
    port = await listen(server);
    assert.equal(
      (await accountA.request(port, "GET", "/api/v1/auth/session")).statusCode,
      200,
    );
    assert.equal(
      (await accountB.request(port, "GET", `/api/v1/projects/${projectA}`))
        .statusCode,
      404,
    );

    const takeover = new BrowserContext(
      `cloud-e2e-a-takeover/${runId}`,
      `device-a-takeover-${runId}`,
    );
    assert.equal(
      (
        await takeover.request(
          port,
          "POST",
          "/api/v1/auth/login",
          takeover.loginBody(usernameA.toLocaleUpperCase("en-US"), password),
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await takeover.request(
          port,
          "POST",
          "/api/v1/auth/login",
          takeover.loginBody(emailA, password, true),
        )
      ).statusCode,
      200,
    );
    assert.notEqual(
      (await accountA.request(port, "GET", "/api/v1/auth/session")).statusCode,
      200,
    );

    const resetPassword = `p7-6-reset-password-${runId}`;
    assert.equal(
      (
        await accountB.request(port, "POST", "/api/v1/auth/password/forgot", {
          email: emailB,
        })
      ).statusCode,
      200,
    );
    const resetCode = authEmailService.getPasswordResetCode();
    assert.match(resetCode, /^\d{6}$/);
    assert.equal(
      (
        await accountB.request(port, "POST", "/api/v1/auth/password/reset", {
          email: emailB,
          code: resetCode,
          password: resetPassword,
        })
      ).statusCode,
      200,
    );
    assert.notEqual(
      (await accountB.request(port, "GET", "/api/v1/auth/session")).statusCode,
      200,
    );

    const resetLogin = new BrowserContext(
      `cloud-e2e-b-reset/${runId}`,
      `device-b-reset-${runId}`,
    );
    assert.equal(
      (
        await resetLogin.request(
          port,
          "POST",
          "/api/v1/auth/login",
          resetLogin.loginBody(emailB, password),
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await resetLogin.request(
          port,
          "POST",
          "/api/v1/auth/login",
          resetLogin.loginBody(emailB, resetPassword),
        )
      ).statusCode,
      200,
    );
  } finally {
    if (server) await closeApiServer(server, 2_000).catch(() => undefined);
    if (pool) {
      if (objectStorage) {
        const managedObjects = await pool
          .query<{ object_key: string }>(
            `
          SELECT object_key FROM assets
          UNION SELECT object_key FROM migration_import_asset_uploads
          UNION SELECT archive_object_key AS object_key FROM migration_exports WHERE archive_object_key IS NOT NULL
        `,
          )
          .catch(() => ({ rows: [] as Array<{ object_key: string }> }));
        for (const row of managedObjects.rows) {
          await objectStorage
            .deleteObject(row.object_key)
            .catch(() => undefined);
        }
      }
      await pool.end();
    }
    if (admin.readyForQuery) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
    await admin.end();
  }
}

const cloudE2ESkip =
  databaseUrl &&
  s3Endpoint &&
  s3Bucket &&
  s3Region &&
  s3AccessKeyId &&
  s3SecretAccessKey
    ? false
    : "DATABASE_URL and S3 test dependencies are not configured";

test(
  "cloud API two-account E2E keeps projects, graph, assets, sessions and devices isolated",
  { skip: cloudE2ESkip },
  runCloudE2E,
);
