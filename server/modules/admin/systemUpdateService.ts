import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SystemUpdateRequestResponse,
  SystemUpdateState,
  SystemUpdateStatusResponse,
} from "@ai-canvas-cloud/contracts";
import type { AdminService } from "./service.js";
import { AdminAccessError } from "./security.js";
import type { AdminRequestContext } from "./types.js";

const REPOSITORY_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]{0,126})\/[a-z0-9](?:[a-z0-9._-]{0,126})$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UPDATE_STATES = new Set<SystemUpdateState>([
  "idle",
  "queued",
  "running",
  "succeeded",
  "failed",
]);

interface SystemUpdateServiceOptions {
  adminService: Pick<AdminService, "requirePermission" | "appendAuditEvent">;
  directory?: string;
  repository?: string;
  currentImage?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

export interface SystemUpdateService {
  getStatus(context: AdminRequestContext): Promise<SystemUpdateStatusResponse>;
  requestUpdate(
    context: AdminRequestContext,
  ): Promise<SystemUpdateRequestResponse>;
}

function digestFromImage(image: string | undefined) {
  const digest = image?.split("@").at(-1)?.trim() ?? "";
  return DIGEST_PATTERN.test(digest) ? digest : null;
}

function parseStatusFile(text: string): {
  state: SystemUpdateState;
  requestId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
} {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const rawState = values.get("STATE") ?? "idle";
  const state = UPDATE_STATES.has(rawState as SystemUpdateState)
    ? (rawState as SystemUpdateState)
    : "failed";
  const requestId = values.get("REQUEST_ID") ?? "";
  return {
    state,
    requestId: REQUEST_ID_PATTERN.test(requestId) ? requestId : null,
    startedAt: values.get("STARTED_AT") || null,
    finishedAt: values.get("FINISHED_AT") || null,
    message: (values.get("MESSAGE") || "").slice(0, 160) || null,
  };
}

function unavailableStatus(checkedAt: string): SystemUpdateStatusResponse {
  return {
    enabled: false,
    state: "idle",
    updateAvailable: false,
    currentDigest: null,
    latestDigest: null,
    requestId: null,
    startedAt: null,
    finishedAt: null,
    message: null,
    checkedAt,
  };
}

export function createSystemUpdateService(
  options: SystemUpdateServiceOptions,
): SystemUpdateService {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const directory = options.directory?.trim();
  const repository = options.repository?.trim().toLowerCase();
  const currentDigest = digestFromImage(options.currentImage);
  const enabled = Boolean(
    directory &&
    repository &&
    REPOSITORY_PATTERN.test(repository) &&
    currentDigest,
  );

  async function requireAccess(context: AdminRequestContext) {
    return options.adminService.requirePermission(
      context,
      "system_update.write",
    );
  }

  async function latestDigest() {
    if (!repository) return null;
    const [namespace, name] = repository.split("/");
    const response = await fetchImpl(
      `https://hub.docker.com/v2/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/tags/stable`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok)
      throw new Error("Docker Hub returned a non-success response");
    const body = (await response.json()) as { digest?: unknown };
    if (typeof body.digest !== "string" || !DIGEST_PATTERN.test(body.digest)) {
      throw new Error("Docker Hub returned an invalid image digest");
    }
    return body.digest;
  }

  async function localStatus() {
    if (!directory) return parseStatusFile("");
    try {
      const requestId = (
        await readFile(join(directory, "request"), "utf8")
      ).trim();
      if (REQUEST_ID_PATTERN.test(requestId)) {
        return {
          state: "queued" as const,
          requestId,
          startedAt: null,
          finishedAt: null,
          message: "Update queued",
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      return parseStatusFile(
        await readFile(join(directory, "status.env"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return parseStatusFile("");
      }
      throw error;
    }
  }

  async function getStatus(context: AdminRequestContext) {
    await requireAccess(context);
    const checkedAt = now().toISOString();
    if (!enabled) return unavailableStatus(checkedAt);
    try {
      const [latest, status] = await Promise.all([
        latestDigest(),
        localStatus(),
      ]);
      return {
        enabled: true,
        ...status,
        updateAvailable:
          status.state !== "queued" &&
          status.state !== "running" &&
          latest !== currentDigest,
        currentDigest,
        latestDigest: latest,
        checkedAt,
      };
    } catch {
      throw new AdminAccessError(
        503,
        "SYSTEM_UPDATE_CHECK_FAILED",
        "Unable to check the release registry",
      );
    }
  }

  return {
    getStatus,
    async requestUpdate(context) {
      const session = await requireAccess(context);
      const status = await getStatus(context);
      if (!status.enabled || !directory) {
        throw new AdminAccessError(
          503,
          "SYSTEM_UPDATE_UNAVAILABLE",
          "System updates are unavailable on this deployment",
        );
      }
      if (status.state === "queued" || status.state === "running") {
        throw new AdminAccessError(
          409,
          "SYSTEM_UPDATE_IN_PROGRESS",
          "A system update is already in progress",
        );
      }
      if (!status.updateAvailable) {
        throw new AdminAccessError(
          409,
          "SYSTEM_UPDATE_UNAVAILABLE",
          "No system update is available",
        );
      }

      const requestId = randomUUID();
      await mkdir(directory, { recursive: true, mode: 0o770 });
      const requestPath = join(directory, "request");
      try {
        await writeFile(requestPath, `${requestId}\n`, {
          encoding: "utf8",
          mode: 0o640,
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new AdminAccessError(
            409,
            "SYSTEM_UPDATE_IN_PROGRESS",
            "A system update is already queued",
          );
        }
        throw error;
      }
      await options.adminService.appendAuditEvent({
        actor: session.admin,
        action: "system_update.request",
        targetType: "deployment",
        targetId: requestId,
        result: "success",
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        after: { requestId, targetDigest: status.latestDigest },
      });
      return { accepted: true, requestId, state: "queued" };
    },
  };
}

export function createUnavailableSystemUpdateService(
  adminService: Pick<AdminService, "requirePermission">,
): SystemUpdateService {
  return {
    async getStatus(context) {
      await adminService.requirePermission(context, "system_update.write");
      return unavailableStatus(new Date().toISOString());
    },
    async requestUpdate(context) {
      await adminService.requirePermission(context, "system_update.write");
      throw new AdminAccessError(
        503,
        "SYSTEM_UPDATE_UNAVAILABLE",
        "System updates are unavailable on this deployment",
      );
    },
  };
}
