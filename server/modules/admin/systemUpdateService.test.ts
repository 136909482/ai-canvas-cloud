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

test("system update authenticates against a same-origin registry mirror", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-canvas-update-mirror-"));
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const manifestUrl =
    "https://docker.1ms.run/v2/hao136909482/ai-canvas-cloud/manifests/stable";
  const service = createSystemUpdateService({
    adminService: adminService([]),
    directory,
    repository: "hao136909482/ai-canvas-cloud",
    currentImage: `hao136909482/ai-canvas-cloud@${currentDigest}`,
    registryOrigin: "https://docker.1ms.run",
    fetch: async (input, init) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("authorization");
      requests.push({ url, authorization });
      if (url === manifestUrl && !authorization) {
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer realm="https://docker.1ms.run/openapi/v1/auth/token", service="docker.1ms.run", scope="repository:hao136909482/ai-canvas-cloud:pull"',
          },
        });
      }
      if (url.startsWith("https://docker.1ms.run/openapi/v1/auth/token?")) {
        return Response.json({ token: "mirror-token" });
      }
      assert.equal(url, manifestUrl);
      assert.equal(authorization, "Bearer mirror-token");
      return new Response("{}", {
        headers: { "docker-content-digest": latestDigest },
      });
    },
  });

  try {
    const status = await service.getStatus(context);
    assert.equal(status.latestDigest, latestDigest);
    assert.equal(status.updateAvailable, true);
    assert.equal(requests.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("system update rejects a registry authentication redirect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-canvas-update-redirect-"));
  const service = createSystemUpdateService({
    adminService: adminService([]),
    directory,
    repository: "hao136909482/ai-canvas-cloud",
    currentImage: `hao136909482/ai-canvas-cloud@${currentDigest}`,
    registryOrigin: "https://docker.1ms.run",
    fetch: async () =>
      new Response(null, {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer realm="https://example.com/token", service="registry", scope="repository:hao136909482/ai-canvas-cloud:pull"',
        },
      }),
  });
  try {
    await assert.rejects(
      () => service.getStatus(context),
      (error: { code?: string }) => error.code === "SYSTEM_UPDATE_CHECK_FAILED",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
