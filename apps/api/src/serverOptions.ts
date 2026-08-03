import type { PublicSiteConfigService } from "@ai-canvas-cloud/server/modules/admin";
import type { AnnouncementTimelineService } from "@ai-canvas-cloud/server/modules/announcements";
import type {
  AssetCleanupService,
  AssetService,
} from "@ai-canvas-cloud/server/modules/assets";
import type { AuthService } from "@ai-canvas-cloud/server/modules/auth";
import type { GenerationTelemetryService } from "@ai-canvas-cloud/server/modules/generation-telemetry";
import type {
  MigrationAssetUploadService,
  MigrationExportService,
  MigrationImportService,
} from "@ai-canvas-cloud/server/modules/migrations";
import type { ProjectGraphService } from "@ai-canvas-cloud/server/modules/project-graph";
import type { ProjectSnapshotService } from "@ai-canvas-cloud/server/modules/project-snapshots";
import type { ProjectService } from "@ai-canvas-cloud/server/modules/projects";
import type { CanvasPreferencesService } from "@ai-canvas-cloud/server/modules/settings";
import type { WorkspaceUsageService } from "@ai-canvas-cloud/server/modules/workspaces";
import type { Logger, MetricsRegistry } from "@ai-canvas-cloud/shared";
import type { ApiConfig } from "./config.js";
import type { RateLimiter } from "./rateLimit.js";

export interface ServerOptions {
  config: ApiConfig;
  logger?: Logger;
  authService?: AuthService;
  generationTelemetryService?: GenerationTelemetryService;
  assetService?: AssetService;
  assetCleanupService?: AssetCleanupService;
  projectGraphService?: ProjectGraphService;
  projectSnapshotService?: ProjectSnapshotService;
  projectService?: ProjectService;
  workspaceUsageService?: WorkspaceUsageService;
  settingsService?: CanvasPreferencesService;
  migrationImportService?: MigrationImportService;
  migrationAssetUploadService?: MigrationAssetUploadService;
  migrationExportService?: MigrationExportService;
  siteConfigService?: PublicSiteConfigService;
  announcementService?: AnnouncementTimelineService;
  metrics?: MetricsRegistry;
  postgresPoolStats?: () => { total: number; idle: number; waiting: number };
  readinessChecks?: {
    postgres?: () => Promise<void>;
    objectStorage?: () => Promise<void>;
    redis?: () => Promise<void>;
  };
  rateLimiter?: RateLimiter;
}
