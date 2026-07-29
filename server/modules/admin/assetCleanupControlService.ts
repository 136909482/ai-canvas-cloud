import {
  type AssetCleanupSummary,
  validateAssetCleanupSummary,
} from "@ai-canvas-cloud/contracts";
import { AdminAccessError } from "./security.js";
import type { AdminRequestContext } from "./types.js";
import type { AdminService } from "./service.js";

export interface AdminAssetCleanupService {
  preview(context: AdminRequestContext): Promise<AssetCleanupSummary>;
  apply(context: AdminRequestContext): Promise<AssetCleanupSummary>;
}

interface Options {
  adminService: Pick<AdminService, "requirePermission" | "appendAuditEvent">;
  apiUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export function createAdminAssetCleanupService(
  options: Options,
): AdminAssetCleanupService {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function run(apply: boolean, context: AdminRequestContext) {
    const session = await options.adminService.requirePermission(
      context,
      "asset_maintenance.write",
    );
    const action = apply
      ? "admin.asset_cleanup.executed"
      : "admin.asset_cleanup.previewed";
    try {
      if (!options.token) throw new Error("Asset cleanup token is unavailable");
      const response = await fetchImpl(
        `${options.apiUrl}/internal/v1/asset-cleanup`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ apply }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error("Asset cleanup API returned an invalid response");
      }
      const summary = validateAssetCleanupSummary(payload);
      await options.adminService.appendAuditEvent({
        actor: session.admin,
        action,
        targetType: "object_storage",
        targetId: "unreferenced_objects",
        result: "success",
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        after: {
          mode: summary.mode,
          reclaimableObjectCount: summary.reclaimableObjectCount,
          reclaimableBytes: summary.reclaimableBytes,
          deletedObjectCount: summary.deletedObjectCount,
          deletedBytes: summary.deletedBytes,
          truncated: summary.truncated,
        },
      });
      return summary;
    } catch (error) {
      await options.adminService
        .appendAuditEvent({
          actor: session.admin,
          action,
          targetType: "object_storage",
          targetId: "unreferenced_objects",
          result: "failure",
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        })
        .catch(() => undefined);
      throw new AdminAccessError(
        503,
        "ASSET_CLEANUP_FAILED",
        error instanceof Error && error.name === "TimeoutError"
          ? "Asset cleanup timed out"
          : "Asset cleanup service is unavailable",
      );
    }
  }

  return {
    preview: (context) => run(false, context),
    apply: (context) => run(true, context),
  };
}

export function createUnavailableAdminAssetCleanupService(): AdminAssetCleanupService {
  const unavailable = async (): Promise<never> => {
    throw new AdminAccessError(
      503,
      "ASSET_CLEANUP_FAILED",
      "Asset cleanup service is unavailable",
    );
  };
  return { preview: unavailable, apply: unavailable };
}
