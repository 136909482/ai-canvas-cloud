import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminAccessError,
  createAdminAssetCleanupService,
  type AdminService,
} from "../../dist/modules/admin/index.js";

const summary = {
  mode: "preview" as const,
  graceHours: 168,
  cutoff: "2026-07-22T00:00:00.000Z",
  scannedAssetCount: 2,
  reclaimableObjectCount: 1,
  reclaimableBytes: 42,
  deletedObjectCount: 0,
  deletedBytes: 0,
  missingObjectCount: 0,
  finalizedMissingAssetCount: 0,
  retainedAssetCount: 1,
  truncated: false,
  completedAt: "2026-07-29T00:00:00.000Z",
};

const context = {
  requestId: "request-1",
  ipAddress: "192.0.2.1",
  userAgent: "test",
};

test("Admin asset cleanup requires permission and sends only the internal aggregate request", async () => {
  const audits: unknown[] = [];
  const adminService = {
    async requirePermission(_context: unknown, permission: string) {
      assert.equal(permission, "asset_maintenance.write");
      return {
        admin: {
          id: "admin-1",
          username: "root",
          role: "super_admin" as const,
          status: "active" as const,
        },
        expiresAt: "2026-07-30T00:00:00.000Z",
      };
    },
    async appendAuditEvent(event: unknown) {
      audits.push(event);
    },
  } as Pick<AdminService, "requirePermission" | "appendAuditEvent">;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const service = createAdminAssetCleanupService({
    adminService,
    apiUrl: "http://api.internal:8787",
    token: "internal-secret-with-at-least-32-characters",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json(summary);
    },
  });

  assert.deepEqual(await service.preview(context), summary);
  assert.equal(
    requests[0]?.url,
    "http://api.internal:8787/internal/v1/asset-cleanup",
  );
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(requests[0]?.init?.body, JSON.stringify({ apply: false }));
  assert.deepEqual(requests[0]?.init?.headers, {
    authorization: "Bearer internal-secret-with-at-least-32-characters",
    "content-type": "application/json",
  });
  const serializedAudit = JSON.stringify(audits);
  assert.equal(serializedAudit.includes("private/"), false);
  assert.equal(serializedAudit.includes("internal-secret"), false);
});

test("Admin asset cleanup maps upstream failures to a stable error", async () => {
  const adminService = {
    async requirePermission() {
      return {
        admin: {
          id: "admin-1",
          username: "root",
          role: "super_admin" as const,
          status: "active" as const,
        },
        expiresAt: "2026-07-30T00:00:00.000Z",
      };
    },
    async appendAuditEvent() {},
  } as Pick<AdminService, "requirePermission" | "appendAuditEvent">;
  const service = createAdminAssetCleanupService({
    adminService,
    apiUrl: "http://api.internal:8787",
    token: "internal-secret-with-at-least-32-characters",
    fetchImpl: async () => new Response("failure", { status: 503 }),
  });

  await assert.rejects(
    () => service.apply(context),
    (error: unknown) =>
      error instanceof AdminAccessError &&
      error.code === "ASSET_CLEANUP_FAILED" &&
      error.statusCode === 503,
  );
});
