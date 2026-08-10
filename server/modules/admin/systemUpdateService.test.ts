import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSystemUpdateService } from "./systemUpdateService.ts";
import type { AdminService } from "./service.ts";

const currentDigest = `sha256:${"1".repeat(64)}`;
const latestDigest = `sha256:${"2".repeat(64)}`;
const context = { requestId: "request-1" };

function adminService(audits: unknown[]) {
  return {
    async requirePermission(_context: unknown, permission: string) {
      assert.equal(permission, "system_update.write");
      return {
        admin: {
          id: "admin-1",
          username: "root",
          role: "super_admin",
          status: "active",
        },
        expiresAt: "2026-08-11T00:00:00.000Z",
      };
    },
    async appendAuditEvent(event: unknown) {
      audits.push(event);
    },
  } as Pick<AdminService, "requirePermission" | "appendAuditEvent">;
}

test("system update checks a fixed Docker Hub tag and queues one host request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-canvas-update-"));
  const audits: unknown[] = [];
  const service = createSystemUpdateService({
    adminService: adminService(audits),
    directory,
    repository: "hao136909482/ai-canvas-cloud",
    currentImage: `hao136909482/ai-canvas-cloud@${currentDigest}`,
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    fetch: async (input) => {
      assert.equal(
        String(input),
        "https://hub.docker.com/v2/repositories/hao136909482/ai-canvas-cloud/tags/stable",
      );
      return new Response(JSON.stringify({ digest: latestDigest }), {
        status: 200,
      });
    },
  });

  try {
    const status = await service.getStatus(context);
    assert.equal(status.enabled, true);
    assert.equal(status.updateAvailable, true);
    assert.equal(status.currentDigest, currentDigest);
    assert.equal(status.latestDigest, latestDigest);

    const queued = await service.requestUpdate(context);
    assert.equal(queued.accepted, true);
    assert.match(queued.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(
      (await readFile(join(directory, "request"), "utf8")).trim(),
      queued.requestId,
    );
    const queuedStatus = await service.getStatus(context);
    assert.equal(queuedStatus.state, "queued");
    assert.equal(queuedStatus.requestId, queued.requestId);
    assert.equal(queuedStatus.updateAvailable, false);
    await assert.rejects(
      () => service.requestUpdate(context),
      (error: { code?: string }) => error.code === "SYSTEM_UPDATE_IN_PROGRESS",
    );
    assert.equal(audits.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("system update remains disabled without the host control directory", async () => {
  const service = createSystemUpdateService({ adminService: adminService([]) });
  const status = await service.getStatus(context);
  assert.equal(status.enabled, false);
  assert.equal(status.updateAvailable, false);
  await assert.rejects(
    () => service.requestUpdate(context),
    (error: { code?: string }) => error.code === "SYSTEM_UPDATE_UNAVAILABLE",
  );
});
