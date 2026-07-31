import type {
  AdminAssetCleanupService,
  AdminDashboardService,
  AdminObjectStorageConfigService,
  AdminService,
  AdminSiteConfigService,
  AdminSmtpConfigService,
  AdminUserOperationsService,
} from "@ai-canvas-cloud/server/modules/admin";
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
  logger: Logger;
  metrics?: MetricsRegistry;
  readinessChecks?: {
    postgres?: () => Promise<MeasuredDependencyStatus>;
    objectStorage?: () => Promise<MeasuredDependencyStatus>;
  };
}
