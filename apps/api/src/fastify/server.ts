import http from "node:http";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import {
  createJsonLogger,
  createMetricsRegistry,
  createRequestId,
} from "@ai-canvas-cloud/shared";
import { createStaticSite } from "@ai-canvas-cloud/server";
import { createUnavailablePublicSiteConfigService } from "@ai-canvas-cloud/server/modules/admin";
import { createUnavailableAnnouncementTimelineService } from "@ai-canvas-cloud/server/modules/announcements";
import { createUnavailableAuthService } from "@ai-canvas-cloud/server/modules/auth";
import {
  createUnavailableCommunityContentService,
  createUnavailableCommunityProfileService,
} from "@ai-canvas-cloud/server/modules/community";
import { createUnavailableWorkspaceUsageService } from "@ai-canvas-cloud/server/modules/workspaces";
import { createUnavailableGenerationTelemetryService } from "@ai-canvas-cloud/server/modules/generation-telemetry";
import { createUnavailableAssetService } from "@ai-canvas-cloud/server/modules/assets";
import {
  createUnavailableMigrationAssetUploadService,
  createUnavailableMigrationExportService,
  createUnavailableMigrationImportService,
} from "@ai-canvas-cloud/server/modules/migrations";
import { createUnavailableProjectGraphService } from "@ai-canvas-cloud/server/modules/project-graph";
import { createUnavailableProjectSnapshotService } from "@ai-canvas-cloud/server/modules/project-snapshots";
import { createUnavailableProjectService } from "@ai-canvas-cloud/server/modules/projects";
import { createUnavailableCanvasPreferencesService } from "@ai-canvas-cloud/server/modules/settings";
import {
  FASTIFY_SERVER_CLOSE,
  type FastifyHttpServer,
} from "../serverLifecycle.js";
import type { ServerOptions } from "../serverOptions.js";
import { registerFastifyFoundation } from "./plugins.js";
import { createFastifyAuthContextAdapter } from "./authContext.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerTelemetryRoutes } from "./routes/telemetry.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerMigrationRoutes } from "./routes/migrations.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerAnnouncementRoutes } from "./routes/announcements.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerCommunityRoutes } from "./routes/community.js";
import { APPLICATION_VERSION } from "../applicationVersion.js";

const PUBLIC_SITE_CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'";

export async function createFastifyApiServer(options: ServerOptions) {
  const logger =
    options.logger ??
    createJsonLogger({ level: options.config.logLevel, service: "api" });
  const metrics = options.metrics ?? createMetricsRegistry();
  const authService = options.authService ?? createUnavailableAuthService();
  const communityProfileService =
    options.communityProfileService ??
    createUnavailableCommunityProfileService();
  const communityContentService =
    options.communityContentService ??
    createUnavailableCommunityContentService();
  const siteConfigService =
    options.siteConfigService ?? createUnavailablePublicSiteConfigService();
  const announcementService =
    options.announcementService ??
    createUnavailableAnnouncementTimelineService();
  const workspaceUsageService =
    options.workspaceUsageService ?? createUnavailableWorkspaceUsageService();
  const settingsService =
    options.settingsService ?? createUnavailableCanvasPreferencesService();
  const generationTelemetryService =
    options.generationTelemetryService ??
    createUnavailableGenerationTelemetryService();
  const assetService = options.assetService ?? createUnavailableAssetService();
  const migrationImportService =
    options.migrationImportService ?? createUnavailableMigrationImportService();
  const migrationAssetUploadService =
    options.migrationAssetUploadService ??
    createUnavailableMigrationAssetUploadService();
  const migrationExportService =
    options.migrationExportService ?? createUnavailableMigrationExportService();
  const projectGraphService =
    options.projectGraphService ?? createUnavailableProjectGraphService();
  const projectSnapshotService =
    options.projectSnapshotService ?? createUnavailableProjectSnapshotService();
  const projectService =
    options.projectService ?? createUnavailableProjectService();
  const staticSite = options.config.staticSiteRoot
    ? createStaticSite({
        root: options.config.staticSiteRoot,
        contentSecurityPolicy: PUBLIC_SITE_CONTENT_SECURITY_POLICY,
        environment: options.config.env,
      })
    : undefined;

  const app = Fastify<http.Server>({
    logger: false,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
      },
    },
    exposeHeadRoutes: false,
    requestIdHeader: false,
    genReqId: () => createRequestId(),
    trustProxy: options.config.trustProxy,
  }).withTypeProvider<TypeBoxTypeProvider>();

  if (options.config.env === "development") {
    const { default: swagger } = await import("@fastify/swagger");
    await app.register(swagger, {
      openapi: {
        info: {
          title: "AI Canvas Cloud Public API",
          version: APPLICATION_VERSION,
        },
      },
    });
  }

  const authContext = createFastifyAuthContextAdapter(authService);
  registerFastifyFoundation(app, {
    authContext,
    config: options.config,
    logger,
    metrics,
    rateLimiter: options.rateLimiter,
    staticSite,
  });
  registerSystemRoutes(app, {
    metrics,
    exposeMetrics: !staticSite,
    siteConfigService,
    postgresPoolStats: options.postgresPoolStats,
    readinessChecks: options.readinessChecks,
  });
  registerWorkspaceRoutes(app, { authContext, workspaceUsageService });
  registerSettingsRoutes(app, { authContext, settingsService });
  registerCommunityRoutes(app, {
    authContext,
    communityProfileService,
    communityContentService,
  });
  registerAnnouncementRoutes(app, { authContext, announcementService });
  registerTelemetryRoutes(app, { authContext, generationTelemetryService });
  registerAuthRoutes(app, authContext);
  registerAssetRoutes(app, {
    assetCleanupService: options.assetCleanupService,
    assetService,
    authContext,
    config: options.config,
  });
  registerMigrationRoutes(app, {
    authContext,
    migrationAssetUploadService,
    migrationExportService,
    migrationImportService,
  });
  registerProjectRoutes(app, {
    authContext,
    projectGraphService,
    projectSnapshotService,
    projectService,
  });

  if (options.config.env === "development") {
    const { default: swaggerUi } = await import("@fastify/swagger-ui");
    await app.register(swaggerUi, {
      routePrefix: "/docs",
      staticCSP: true,
      uiConfig: { docExpansion: "list", deepLinking: false },
    });
  }

  await app.ready();
  const server = app.server as FastifyHttpServer;
  server[FASTIFY_SERVER_CLOSE] = async () => {
    await app.close();
  };
  return server;
}
