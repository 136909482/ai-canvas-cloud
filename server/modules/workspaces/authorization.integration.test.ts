import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { loadDotEnv } from "../../dist/env/loadDotEnv.js";
import { AuthServiceError } from "../../dist/modules/auth/service.js";
import { createWorkspaceAuthorizationService } from "../../dist/modules/workspaces/authorization.js";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test(
  "PostgreSQL owner admin editor viewer authorization matrix is explicit and non-disclosing",
  {
    skip: databaseUrl ? false : "DATABASE_URL is not configured",
  },
  async () => {
    const schemaName = `authorization_matrix_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let pool: pg.Pool | undefined;

    try {
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schemaName}"`);
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 2,
        options: `-c search_path=${schemaName},public`,
      });
      for (const fileName of [
        "0001_schema_migrations.sql",
        "0002_auth_workspaces.sql",
      ]) {
        await pool.query(
          await readFile(
            join(process.cwd(), "server", "db", "migrations", fileName),
            "utf8",
          ),
        );
      }
      await pool.query(`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES
        ('role-owner', 'Owner', 'role-owner@example.invalid', true),
        ('role-admin', 'Admin', 'role-admin@example.invalid', true),
        ('role-editor', 'Editor', 'role-editor@example.invalid', true),
        ('role-viewer', 'Viewer', 'role-viewer@example.invalid', true),
        ('role-outsider', 'Outsider', 'role-outsider@example.invalid', true)
    `);
      await pool.query(
        `
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ($1, 'Role matrix workspace', 'role-owner')
    `,
        [WORKSPACE_ID],
      );
      await pool.query(
        `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES
        ($1, 'role-owner', 'owner'),
        ($1, 'role-admin', 'admin'),
        ($1, 'role-editor', 'editor'),
        ($1, 'role-viewer', 'viewer')
    `,
        [WORKSPACE_ID],
      );

      const service = createWorkspaceAuthorizationService(pool);
      const scenarios = [
        {
          name: "read",
          allowedRoles: undefined,
          allowed: ["owner", "admin", "editor", "viewer"],
        },
        {
          name: "content write",
          allowedRoles: ["owner", "admin", "editor"],
          allowed: ["owner", "admin", "editor"],
        },
        {
          name: "administration",
          allowedRoles: ["owner", "admin"],
          allowed: ["owner", "admin"],
        },
        { name: "ownership", allowedRoles: ["owner"], allowed: ["owner"] },
      ] as const;

      for (const scenario of scenarios) {
        for (const role of ["owner", "admin", "editor", "viewer"] as const) {
          const operation = service.requireWorkspaceAccess({
            userId: `role-${role}`,
            workspaceId: WORKSPACE_ID,
            ...(scenario.allowedRoles
              ? { allowedRoles: [...scenario.allowedRoles] }
              : {}),
          });
          if (scenario.allowed.includes(role)) {
            const access = await operation;
            assert.equal(access.member.role, role, `${scenario.name}:${role}`);
          } else {
            await assert.rejects(
              operation,
              (error: unknown) =>
                error instanceof AuthServiceError &&
                error.statusCode === 403 &&
                error.apiCode === "ACCESS_DENIED",
              `${scenario.name}:${role}`,
            );
          }
        }
      }

      await assert.rejects(
        () =>
          service.requireWorkspaceAccess({
            userId: "role-outsider",
            workspaceId: WORKSPACE_ID,
          }),
        (error: unknown) =>
          error instanceof AuthServiceError &&
          error.statusCode === 404 &&
          error.apiCode === "RESOURCE_NOT_FOUND",
      );
    } finally {
      await pool?.end();
      if (admin.readyForQuery)
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  },
);
