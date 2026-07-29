import {
  createJsonLogger,
  createMetricsRegistry,
  measureDependencyCheck,
} from "@ai-canvas-cloud/shared";
import {
  createPostgresAdminService,
  createPostgresAdminDashboardService,
  createPostgresAdminSiteConfigService,
  createPostgresAdminSmtpConfigService,
  createPostgresAdminObjectStorageConfigService,
  createAdminAssetCleanupService,
  createPostgresAdminUserOperationsService,
  createPostgresPool,
  createManagedS3ObjectStorage,
  createObjectStorageCredentialKeyring,
  createSmtpCredentialKeyring,
  legacySmtpRuntimeConfig,
  loadDotEnv,
} from "@ai-canvas-cloud/server";
import { loadAdminApiConfig } from "./config.js";
import { closeAdminApiServer, createAdminApiServer } from "./server.js";

loadDotEnv();

const config = loadAdminApiConfig();
const logger = createJsonLogger({
  level: config.logLevel,
  service: "admin-api",
});
const pool = createPostgresPool({
  connectionString: config.databaseUrl,
  schema: "admin",
});
const adminService = createPostgresAdminService(pool, {
  baseURL: config.betterAuthUrl,
  secret: config.betterAuthSecret,
  trustedOrigins: config.allowedOrigins,
  environment: config.env,
});
const objectStorageKeyring = createObjectStorageCredentialKeyring({
  serializedKeys: config.objectStorageCredentialKeys,
  activeVersion: config.objectStorageCredentialActiveKeyVersion,
  developmentSecret: config.smtpDevelopmentSecret,
});
const fallbackObjectStorage = config.objectStorageEnvironmentFallback
  ? {
      endpoint: config.s3Endpoint,
      publicEndpoint: config.s3PublicEndpoint,
      publicOrigin: config.s3PublicOrigin,
      bucket: config.s3Bucket,
      region: config.s3Region,
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
      forcePathStyle: config.s3ForcePathStyle,
    }
  : undefined;
const objectStorage = createManagedS3ObjectStorage(pool, {
  keyring: objectStorageKeyring,
  fallback: fallbackObjectStorage,
});
const siteConfigService = createPostgresAdminSiteConfigService(pool, {
  adminService,
  objectStorage,
  auditSecret: config.betterAuthSecret,
});
const metrics = createMetricsRegistry();
const legacySmtpConfig =
  config.smtpHost &&
  config.smtpPort &&
  config.smtpFrom &&
  config.smtpUsername &&
  config.smtpPassword
    ? legacySmtpRuntimeConfig({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        from: config.smtpFrom,
        username: config.smtpUsername,
        password: config.smtpPassword,
      })
    : undefined;
const smtpConfigService = createPostgresAdminSmtpConfigService(pool, {
  adminService,
  keyring: createSmtpCredentialKeyring({
    serializedKeys: config.smtpCredentialKeys,
    activeVersion: config.smtpCredentialActiveKeyVersion,
    developmentSecret: config.smtpDevelopmentSecret,
  }),
  fallbackConfig: legacySmtpConfig,
  auditSecret: config.betterAuthSecret,
  metrics,
});
const objectStorageConfigService =
  createPostgresAdminObjectStorageConfigService(pool, {
    adminService,
    keyring: objectStorageKeyring,
    fallbackConfig: fallbackObjectStorage,
    auditSecret: config.betterAuthSecret,
    invalidateManagedConfig: objectStorage.invalidateManagedConfig,
  });
const assetCleanupService = createAdminAssetCleanupService({
  adminService,
  apiUrl: config.assetMaintenanceApiUrl,
  token: config.assetMaintenanceToken,
});
const userOperationsService = createPostgresAdminUserOperationsService(pool, {
  adminService,
  auditSecret: config.betterAuthSecret,
});
const readinessChecks = {
  postgres: () =>
    measureDependencyCheck(async () => {
      await pool.query("SELECT 1");
    }),
  objectStorage: () => measureDependencyCheck(objectStorage.checkHealth),
};
const dashboardService = createPostgresAdminDashboardService(pool, {
  adminService,
  readInfrastructureHealth: async () => {
    const [postgres, objectStorageHealth] = await Promise.all([
      readinessChecks.postgres(),
      readinessChecks.objectStorage(),
    ]);
    return { postgres, objectStorage: objectStorageHealth };
  },
});
const server = createAdminApiServer({
  config,
  adminService,
  dashboardService,
  siteConfigService,
  smtpConfigService,
  objectStorageConfigService,
  assetCleanupService,
  userOperationsService,
  logger,
  metrics,
  readinessChecks,
});

let closing = false;
async function shutdown(signal: NodeJS.Signals) {
  if (closing) return;
  closing = true;
  logger.info("shutdown.started", { signal });
  try {
    await closeAdminApiServer(server, config.shutdownTimeoutMs);
    objectStorage.destroy();
    await pool.end();
    logger.info("shutdown.completed", { signal });
    process.exit(0);
  } catch (error) {
    logger.error("shutdown.failed", {
      signal,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    process.exit(1);
  }
}

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));

server.listen(config.port, config.host, () => {
  logger.info("server.listening", {
    host: config.host,
    port: config.port,
    env: config.env,
  });
});
