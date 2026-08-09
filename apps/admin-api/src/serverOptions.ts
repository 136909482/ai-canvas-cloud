import type {
  AdminAssetCleanupService,
  AdminDashboardService,
  AdminObjectStorageConfigService,
  AdminService,
  AdminSiteConfigService,
  AdminSmtpConfigService,
  AdminUserOperationsService,
} from "@ai-canvas-cloud/server/modules/admin";
import type { AdminAnnouncementService } from "@ai-canvas-cloud/server/modules/announcements";
import type { AdminCommunityModerationService } from "@ai-canvas-cloud/server/modules/community";
import type {
  Logger,
  MeasuredDependencyStatus,
  MetricsRegistry,
} from "@ai-canvas-cloud/shared";
import type { AdminApiConfig } from "./config.js";

export interface AdminServerOptions {
  config: AdminApiConfig;
  adminService: AdminService;
  dashboardService?: AdminDashboardService;
  siteConfigService?: AdminSiteConfigService;
  smtpConfigService?: AdminSmtpConfigService;
  objectStorageConfigService?: AdminObjectStorageConfigService;
  assetCleanupService?: AdminAssetCleanupService;
  userOperationsService?: AdminUserOperationsService;
  announcementService?: AdminAnnouncementService;
  communityModerationService?: AdminCommunityModerationService;
  logger: Logger;
  metrics?: MetricsRegistry;
  readinessChecks?: {
    postgres?: () => Promise<MeasuredDependencyStatus>;
    objectStorage?: () => Promise<MeasuredDependencyStatus>;
  };
}
