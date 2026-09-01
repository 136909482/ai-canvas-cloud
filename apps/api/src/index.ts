import {
  createDevelopmentAuthEmailService,
  createManagedSmtpAuthEmailService,
  createSmtpCredentialKeyring,
  createPostgresAssetService,
  createPostgresAssetMaintenanceService,
  createAssetCleanupService,
  createPostgresAuthService,
  createPostgresGenerationTelemetryService,
  createPostgresGenerationTaskRecordService,
  createOfficialGenerationKeyring,
  createPostgresOfficialGenerationService,
  createOfficialGenerationWorker,
  createPostgresPool,
  createPostgresProjectGraphService,
  createPostgresProjectSnapshotService,
  createPostgresProjectService,
  createManagedS3ObjectStorage,
  createObjectStorageCredentialKeyring,
  createWorkspaceAuthorizationService,
  createPostgresWorkspaceUsageService,
  createPostgresCanvasPreferencesService,
  createPostgresCommunityProfileService,
  createPostgresCommunityContentService,
  createPostgresMigrationImportService,
  createPostgresMigrationAssetUploadService,
  createPostgresMigrationExportService,
  createPostgresPublicSiteConfigService,
  createPostgresAnnouncementTimelineService,
  loadDotEnv,
  seedDevelopmentAdminAccount,
} from "@ai-canvas-cloud/server";
import {
  createJsonLogger,
  createMetricsRegistry,
} from "@ai-canvas-cloud/shared";
import { loadApiConfig } from "./config.js";
import { closeApiServer } from "./serverLifecycle.js";
import { createFastifyApiServer } from "./fastify/server.js";
import { createRedisRateLimiter } from "./rateLimit.js";

loadDotEnv();

const config = loadApiConfig();
const logger = createJsonLogger({ level: config.logLevel, service: "api" });
const metrics = createMetricsRegistry();
const dbPool = createPostgresPool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
});
const rateLimiter = createRedisRateLimiter(config.redisUrl, config.env);
const authEmailService =
  config.authEmailTransport === "managed"
    ? createManagedSmtpAuthEmailService(dbPool, {
        keyring: createSmtpCredentialKeyring({
          serializedKeys: config.smtpCredentialKeys,
          activeVersion: config.smtpCredentialActiveKeyVersion,
          developmentSecret:
            config.env === "development" ? config.betterAuthSecret : undefined,
        }),
        metrics,
      })
    : createDevelopmentAuthEmailService({
        env: config.env,
        logger,
      });
const workspaceAuthorizationService =
  createWorkspaceAuthorizationService(dbPool);
const generationTelemetryService = createPostgresGenerationTelemetryService(
  dbPool,
  { authorizationService: workspaceAuthorizationService },
);
const generationTaskRecordService = createPostgresGenerationTaskRecordService(
  dbPool,
  {
    authorizationService: workspaceAuthorizationService,
  },
);
const officialGenerationKeyring = createOfficialGenerationKeyring({
  serializedKeys: config.officialGenerationCredentialKeys,
  activeVersion: config.officialGenerationCredentialActiveKeyVersion,
  developmentSecret:
    config.env === "development" ? config.betterAuthSecret : undefined,
});
const officialGenerationService = createPostgresOfficialGenerationService(
  dbPool,
  {
    keyring: officialGenerationKeyring,
    redemptionCodePepper: config.redemptionCodePepper,
  },
);
const objectStorage = createManagedS3ObjectStorage(dbPool, {
  keyring: createObjectStorageCredentialKeyring({
    serializedKeys: config.objectStorageCredentialKeys,
    activeVersion: config.objectStorageCredentialActiveKeyVersion,
    developmentSecret:
      config.env === "development" ? config.betterAuthSecret : undefined,
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
const assetService = createPostgresAssetService(dbPool, {
  authorizationService: workspaceAuthorizationService,
  objectStorage,
});
const assetCleanupService = createAssetCleanupService(
  createPostgresAssetMaintenanceService(dbPool, objectStorage),
);
const officialGenerationWorker = createOfficialGenerationWorker({
  pool: dbPool,
  storage: objectStorage,
  keyring: officialGenerationKeyring,
});
const projectGraphService = createPostgresProjectGraphService(dbPool, {
  authorizationService: workspaceAuthorizationService,
});
const projectSnapshotService = createPostgresProjectSnapshotService(dbPool, {
  authorizationService: workspaceAuthorizationService,
});
const projectService = createPostgresProjectService(dbPool, {
  authorizationService: workspaceAuthorizationService,
});
const workspaceUsageService = createPostgresWorkspaceUsageService(dbPool, {
  authorizationService: workspaceAuthorizationService,
});
const settingsService = createPostgresCanvasPreferencesService(dbPool, {
  authorizationService: workspaceAuthorizationService,
});
const communityProfileService = createPostgresCommunityProfileService(dbPool);
const communityContentService = createPostgresCommunityContentService(dbPool);
const migrationImportService = createPostgresMigrationImportService(dbPool, {
  authorizationService: workspaceAuthorizationService,
});
const migrationAssetUploadService = createPostgresMigrationAssetUploadService(
  dbPool,
  objectStorage,
  {
    authorizationService: workspaceAuthorizationService,
  },
);
const migrationExportService = createPostgresMigrationExportService(
  dbPool,
  objectStorage,
  {
    authorizationService: workspaceAuthorizationService,
  },
);
const siteConfigService = createPostgresPublicSiteConfigService(
  dbPool,
  objectStorage,
);
const announcementService = createPostgresAnnouncementTimelineService(dbPool);
const authService = createPostgresAuthService(dbPool, {
  baseURL: config.betterAuthUrl,
  secret: config.betterAuthSecret,
  publicWebUrl: config.webPublicUrl,
  trustedOrigins: config.webAllowedOrigins,
  environment: config.env,
  emailService: authEmailService,
  registrationEmailVerificationRequired: async () =>
    (await siteConfigService.getCurrent()).config.features
      .registrationEmailVerificationRequired,
});
const serverOptions = {
  config,
  logger,
  authService,
  generationTelemetryService,
  generationTaskRecordService,
  officialGenerationService,
  assetService,
  assetCleanupService,
  projectGraphService,
  projectSnapshotService,
  projectService,
  workspaceUsageService,
  settingsService,
  communityProfileService,
  communityContentService,
  migrationImportService,
  migrationAssetUploadService,
  migrationExportService,
  siteConfigService,
  announcementService,
  metrics,
  postgresPoolStats: () => ({
    total: dbPool.totalCount,
    idle: dbPool.idleCount,
    waiting: dbPool.waitingCount,
  }),
  rateLimiter,
  readinessChecks: {
    async postgres() {
      await dbPool.query("SELECT 1");
    },
    objectStorage: objectStorage.checkHealth,
    redis: rateLimiter.ping,
  },
};
const server = await createFastifyApiServer(serverOptions);
await officialGenerationWorker.start();
void migrationExportService.recoverExports().catch(() => undefined);
void migrationAssetUploadService
  .maintainStagingObjects()
  .catch(() => undefined);
const migrationMaintenanceTimer = setInterval(
  () => {
    void migrationExportService.maintainExports().catch(() => undefined);
    void migrationAssetUploadService
      .maintainStagingObjects()
      .catch(() => undefined);
  },
  15 * 60 * 1000,
);
migrationMaintenanceTimer.unref();

void seedDevelopmentAdminAccount({
  enabled: config.devSeedAdmin,
  env: config.env,
  username: config.devSeedAdminUsername,
  email: config.devSeedAdminEmail,
  password: config.devSeedAdminPassword,
  authService,
  pool: dbPool,
  logger,
});

let isClosing = false;

async function shutdown(signal: NodeJS.Signals) {
  if (isClosing) {
    return;
  }

  isClosing = true;
  logger.info("shutdown.started", { signal });
  clearInterval(migrationMaintenanceTimer);

  try {
    await closeApiServer(server, config.shutdownTimeoutMs);
    await officialGenerationWorker.stop();
    await rateLimiter.close();
    objectStorage.destroy();
    await dbPool.end();
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
