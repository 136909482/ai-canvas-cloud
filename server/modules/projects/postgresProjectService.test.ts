import assert from "node:assert/strict";
import test from "node:test";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createPostgresProjectService } from "../../dist/modules/projects/postgresProjectService.js";
import type { WorkspaceAuthorizationService } from "../../dist/modules/workspaces/authorization.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

interface QueryCall {
  text: string;
  values?: unknown[];
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    name: "产品主视觉",
    version: "0",
    last_sequence: "0",
    node_count: 0,
    edge_count: 0,
    archived_at: null,
    created_at: new Date("2026-07-15T00:00:00.000Z"),
    updated_at: new Date("2026-07-15T00:00:00.000Z"),
    ...overrides,
  };
}

function createAuthorizationService() {
  const calls: Parameters<
    WorkspaceAuthorizationService["requireWorkspaceAccess"]
  >[0][] = [];
  const service: WorkspaceAuthorizationService = {
    async requireWorkspaceAccess(input) {
      calls.push(input);
      return {
        workspace: {
          id: input.workspaceId,
          type: "personal",
          name: "个人空间",
          status: "active",
          planKey: "free",
          ownerUserId: input.userId,
        },
        member: {
          userId: input.userId,
          role: "owner",
        },
      };
    },
  };

  return { calls, service };
}

function createMockPool(handler: (call: QueryCall) => { rows: unknown[] }) {
  const calls: QueryCall[] = [];

  return {
    calls,
    pool: {
      async query(text: string, values?: unknown[]) {
        const call = { text, values };
        calls.push(call);
        return handler(call);
      },
    },
  };
}

test("project creation trims names and scopes inserts to the authorized workspace", async () => {
  const authorization = createAuthorizationService();
  const { pool, calls } = createMockPool(() => ({ rows: [projectRow()] }));
  const service = createPostgresProjectService(pool as never, {
    authorizationService: authorization.service,
  });

  const response = await service.createProject(
    { name: "  产品主视觉  " },
    { userId: "user-a", workspaceId: "workspace-a" },
  );

  assert.equal(response.project.name, "产品主视觉");
  assert.deepEqual(calls[0]?.values, [null, "workspace-a", "产品主视觉"]);
  assert.deepEqual(authorization.calls[0], {
    userId: "user-a",
    workspaceId: "workspace-a",
    allowedRoles: ["owner", "admin", "editor"],
  });
});

test("project list uses opaque keyset cursors and never returns workspace ids", async () => {
  const authorization = createAuthorizationService();
  const secondProjectId = "22222222-2222-4222-8222-222222222222";
  const rows = [
    projectRow(),
    projectRow({
      id: secondProjectId,
      name: "第二个项目",
      updated_at: new Date("2026-07-14T00:00:00.000Z"),
    }),
  ];
  const { pool, calls } = createMockPool(() => ({ rows }));
  const service = createPostgresProjectService(pool as never, {
    authorizationService: authorization.service,
  });

  const firstPage = await service.listProjects(
    { status: "active", limit: 1 },
    { userId: "user-a", workspaceId: "workspace-a" },
  );

  assert.equal(firstPage.projects.length, 1);
  assert(firstPage.nextCursor);
  assert.equal("workspaceId" in firstPage.projects[0]!, false);
  assert.deepEqual(calls[0]?.values, ["workspace-a", "active", 2]);

  await service.listProjects(
    { status: "active", limit: 1, cursor: firstPage.nextCursor },
    { userId: "user-a", workspaceId: "workspace-a" },
  );

  assert.equal(calls[1]?.values?.[0], "workspace-a");
  assert.equal(calls[1]?.values?.[2], "2026-07-15T00:00:00.000Z");
  assert.equal(calls[1]?.values?.[3], PROJECT_ID);
});

test("project reads hide projects outside the actor workspace", async () => {
  const authorization = createAuthorizationService();
  const { pool, calls } = createMockPool((call) => ({
    rows: call.values?.[1] === "workspace-b" ? [projectRow()] : [],
  }));
  const service = createPostgresProjectService(pool as never, {
    authorizationService: authorization.service,
  });

  await assert.rejects(
    () =>
      service.getProject(PROJECT_ID, {
        userId: "user-a",
        workspaceId: "workspace-a",
      }),
    (error: unknown) =>
      error instanceof AuthServiceError &&
      error.statusCode === 404 &&
      error.apiCode === "RESOURCE_NOT_FOUND",
  );

  assert.deepEqual(calls[0]?.values, [PROJECT_ID, "workspace-a"]);
});

test("project metadata mutations and soft delete remain workspace-scoped", async () => {
  const authorization = createAuthorizationService();
  const { pool, calls } = createMockPool((call) => {
    if (call.text.includes("SELECT EXISTS")) {
      return { rows: [{ deleted: true }] };
    }

    return { rows: [projectRow()] };
  });
  const service = createPostgresProjectService(pool as never, {
    authorizationService: authorization.service,
  });
  const actor = { userId: "user-a", workspaceId: "workspace-a" };

  await service.renameProject(PROJECT_ID, { name: "新名称" }, actor);
  await service.archiveProject(PROJECT_ID, actor);
  await service.restoreProject(PROJECT_ID, actor);
  assert.deepEqual(await service.deleteProject(PROJECT_ID, actor), {
    ok: true,
  });

  assert(calls.every((call) => call.values?.[1] === "workspace-a"));
  assert.match(calls[3]!.text, /SET deleted_at = now\(\)/);
  assert.match(calls[3]!.text, /UPDATE workspace_user_state/);
});

test("project service rejects invalid names, ids, filters, and cursors", async () => {
  const authorization = createAuthorizationService();
  const { pool } = createMockPool(() => ({ rows: [] }));
  const service = createPostgresProjectService(pool as never, {
    authorizationService: authorization.service,
  });
  const actor = { userId: "user-a", workspaceId: "workspace-a" };

  await assert.rejects(
    () => service.createProject({ name: "   " }, actor),
    AuthServiceError,
  );
  await assert.rejects(
    () => service.createProject({ id: "not-a-uuid", name: "项目" }, actor),
    AuthServiceError,
  );
  await assert.rejects(
    () => service.getProject("not-a-uuid", actor),
    AuthServiceError,
  );
  await assert.rejects(
    () => service.listProjects({ status: "deleted" as never }, actor),
    AuthServiceError,
  );
  await assert.rejects(
    () => service.listProjects({ cursor: "invalid" }, actor),
    AuthServiceError,
  );
});
