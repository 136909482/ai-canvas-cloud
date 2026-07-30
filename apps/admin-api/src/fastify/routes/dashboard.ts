import {
  AdminErrorResponseSchema,
  AdminJsonObjectSchema,
} from "@ai-canvas-cloud/contracts/admin-http-schema";
import type {
  AdminDashboardService,
  AdminService,
} from "@ai-canvas-cloud/server/modules/admin";
import type { AdminApiConfig } from "../../config.js";
import { adminOperation, adminRequestContext } from "../helpers.js";
import type { AdminFastifyInstance } from "../types.js";

const responses = {
  200: AdminJsonObjectSchema,
  400: AdminErrorResponseSchema,
  401: AdminErrorResponseSchema,
  403: AdminErrorResponseSchema,
  500: AdminErrorResponseSchema,
  503: AdminErrorResponseSchema,
};

export function registerAdminDashboardRoutes(
  app: AdminFastifyInstance,
  options: {
    config: AdminApiConfig;
    adminService: AdminService;
    dashboardService: AdminDashboardService;
  },
) {
  app.get(
    "/admin/v1/audit-events",
    {
      schema: {
        operationId: adminOperation("listAdminAuditEvents"),
        tags: ["dashboard-audit"],
        response: responses,
      },
    },
    async (request) => {
      const url = new URL(request.raw.url ?? "/", "http://localhost");
      const limitValue = url.searchParams.get("limit");
      const resultValue = url.searchParams.get("result");
      return options.adminService.listAuditEvents(
        {
          cursor: url.searchParams.get("cursor") ?? undefined,
          action: url.searchParams.get("action") ?? undefined,
          result:
            resultValue === "success" || resultValue === "failure"
              ? resultValue
              : undefined,
          limit: limitValue === null ? undefined : Number(limitValue),
        },
        adminRequestContext(request, options.config),
      );
    },
  );

  app.get(
    "/admin/v1/dashboard",
    {
      schema: {
        operationId: adminOperation("getAdminDashboard"),
        tags: ["dashboard-audit"],
        response: responses,
      },
    },
    async (request) =>
      options.dashboardService.getDashboard(
        adminRequestContext(request, options.config),
      ),
  );
}
