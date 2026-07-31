import type {
  ProjectListStatus,
  ProjectSummary,
  WorkspaceRole,
} from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import {
  createWorkspaceAuthorizationService,
  type WorkspaceAuthorizationService,
} from "../workspaces/authorization.js";
import {
  normalizeProjectName,
  normalizeProjectId,
  PROJECT_LIST_DEFAULT_LIMIT,
  PROJECT_LIST_MAX_LIMIT,
  type ProjectActor,
  type ProjectService,
} from "./service.js";

const PROJECT_WRITE_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "admin",
  "editor",
];
const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProjectRow {
  id: string;
  name: string;
  version: string | number;
  last_sequence: string | number;
  node_count: number;
  edge_count: number;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProjectCursor {
  updatedAt: string;
  id: string;
}

const PROJECT_COLUMNS = `
  id::text AS id,
  name,
  version,
  last_sequence,
  node_count,
  edge_count,
  archived_at,
  created_at,
  updated_at
`;

function toIso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    version: Number(row.version),
    lastSequence: Number(row.last_sequence),
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    archivedAt: row.archived_at ? toIso(row.archived_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function assertProjectId(projectId: string) {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid project id",
    });
  }
}

function normalizeListStatus(
  status: ProjectListStatus | undefined,
): ProjectListStatus {
  if (status === undefined || status === "active" || status === "archived") {
    return status ?? "active";
  }

  throw new AuthServiceError({
    statusCode: 400,
    apiCode: "VALIDATION_FAILED",
    message: "Project status must be active or archived",
  });
}

function normalizeListLimit(limit: number | undefined) {
  const normalized = limit ?? PROJECT_LIST_DEFAULT_LIMIT;

  if (
    !Number.isInteger(normalized) ||
    normalized < 1 ||
    normalized > PROJECT_LIST_MAX_LIMIT
  ) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: `Project list limit must be between 1 and ${PROJECT_LIST_MAX_LIMIT}`,
    });
  }

  return normalized;
}

function encodeCursor(project: ProjectSummary) {
  return Buffer.from(
    JSON.stringify({
      updatedAt: project.updatedAt,
      id: project.id,
    } satisfies ProjectCursor),
  ).toString("base64url");
}

function decodeCursor(cursor: string): ProjectCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<ProjectCursor>;

    if (
      typeof parsed.updatedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.updatedAt)) ||
      typeof parsed.id !== "string" ||
      !PROJECT_ID_PATTERN.test(parsed.id)
    ) {
      throw new Error("Invalid cursor payload");
    }

    return {
      updatedAt: parsed.updatedAt,
      id: parsed.id,
    };
  } catch {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Invalid project list cursor",
    });
  }
}

function projectNotFound(): never {
  throw new AuthServiceError({
    statusCode: 404,
    apiCode: "RESOURCE_NOT_FOUND",
    message: "Project not found",
  });
}

async function authorize(
  authorizationService: WorkspaceAuthorizationService,
  actor: ProjectActor,
  allowedRoles?: readonly WorkspaceRole[],
) {
  await authorizationService.requireWorkspaceAccess({
    userId: actor.userId,
    workspaceId: actor.workspaceId,
    allowedRoles,
  });
}

export function createPostgresProjectService(
  pool: Pick<DbPool, "query">,
  options: { authorizationService?: WorkspaceAuthorizationService } = {},
): ProjectService {
  const authorizationService =
    options.authorizationService ?? createWorkspaceAuthorizationService(pool);

  async function findProject(projectId: string, actor: ProjectActor) {
    assertProjectId(projectId);
    const result = await pool.query<ProjectRow>(
      `
        SELECT ${PROJECT_COLUMNS}
        FROM projects
        WHERE id = $1
          AND workspace_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [projectId, actor.workspaceId],
    );

    return result.rows[0] ?? projectNotFound();
  }

  async function updateProject(
    projectId: string,
    actor: ProjectActor,
    setClause: string,
    values: unknown[] = [],
  ) {
    assertProjectId(projectId);
    const result = await pool.query<ProjectRow>(
      `
        UPDATE projects
        SET ${setClause}
        WHERE id = $1
          AND workspace_id = $2
          AND deleted_at IS NULL
        RETURNING ${PROJECT_COLUMNS}
      `,
      [projectId, actor.workspaceId, ...values],
    );

    return result.rows[0] ?? projectNotFound();
  }

  return {
    async listProjects(input, actor) {
      await authorize(authorizationService, actor);
      const status = normalizeListStatus(input.status);
      const limit = normalizeListLimit(input.limit);
      const values: unknown[] = [actor.workspaceId, status];
      let cursorClause = "";

      if (input.cursor) {
        const cursor = decodeCursor(input.cursor);
        values.push(cursor.updatedAt, cursor.id);
        cursorClause = `AND (updated_at, id) < ($3::timestamptz, $4::uuid)`;
      }

      values.push(limit + 1);
      const result = await pool.query<ProjectRow>(
        `
          SELECT ${PROJECT_COLUMNS}
          FROM projects
          WHERE workspace_id = $1
            AND deleted_at IS NULL
            AND (
              ($2 = 'active' AND archived_at IS NULL)
              OR ($2 = 'archived' AND archived_at IS NOT NULL)
            )
            ${cursorClause}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${values.length}
        `,
        values,
      );
      const hasNextPage = result.rows.length > limit;
      const projects = result.rows.slice(0, limit).map(toProjectSummary);

      return {
        projects,
        nextCursor:
          hasNextPage && projects.length > 0
            ? encodeCursor(projects[projects.length - 1]!)
            : null,
      };
    },

    async createProject(input, actor) {
      await authorize(authorizationService, actor, PROJECT_WRITE_ROLES);
      const projectId = normalizeProjectId(input.id);
      const name = normalizeProjectName(input.name);
      const result = await pool.query<ProjectRow>(
        `
          INSERT INTO projects (id, workspace_id, name)
          VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
          ON CONFLICT (id) DO UPDATE
          SET name = projects.name
          WHERE projects.workspace_id = EXCLUDED.workspace_id
            AND projects.name = EXCLUDED.name
            AND projects.deleted_at IS NULL
          RETURNING ${PROJECT_COLUMNS}
        `,
        [projectId ?? null, actor.workspaceId, name],
      );

      if (!result.rows[0]) {
        throw new AuthServiceError({
          statusCode: 409,
          apiCode: "VALIDATION_FAILED",
          message: "Project id is already in use",
        });
      }

      return { project: toProjectSummary(result.rows[0]) };
    },

    async getProject(projectId, actor) {
      await authorize(authorizationService, actor);
      return { project: toProjectSummary(await findProject(projectId, actor)) };
    },

    async renameProject(projectId, input, actor) {
      await authorize(authorizationService, actor, PROJECT_WRITE_ROLES);
      const name = normalizeProjectName(input.name);
      const row = await updateProject(
        projectId,
        actor,
        "name = $3, updated_at = now()",
        [name],
      );
      return { project: toProjectSummary(row) };
    },

    async archiveProject(projectId, actor) {
      await authorize(authorizationService, actor, PROJECT_WRITE_ROLES);
      const row = await updateProject(
        projectId,
        actor,
        `updated_at = CASE WHEN archived_at IS NULL THEN now() ELSE updated_at END,
         archived_at = COALESCE(archived_at, now())`,
      );
      return { project: toProjectSummary(row) };
    },

    async restoreProject(projectId, actor) {
      await authorize(authorizationService, actor, PROJECT_WRITE_ROLES);
      const row = await updateProject(
        projectId,
        actor,
        `updated_at = CASE WHEN archived_at IS NOT NULL THEN now() ELSE updated_at END,
         archived_at = NULL`,
      );
      return { project: toProjectSummary(row) };
    },

    async deleteProject(projectId, actor) {
      await authorize(authorizationService, actor, PROJECT_WRITE_ROLES);
      assertProjectId(projectId);
      const result = await pool.query<{ deleted: boolean }>(
        `
          WITH deleted_project AS (
            UPDATE projects
            SET deleted_at = now(), updated_at = now()
            WHERE id = $1
              AND workspace_id = $2
              AND deleted_at IS NULL
            RETURNING id
          ), cleared_state AS (
            UPDATE workspace_user_state
            SET last_opened_project_id = CASE WHEN last_opened_project_id = $1 THEN NULL ELSE last_opened_project_id END,
                active_project_id = CASE WHEN active_project_id = $1 THEN NULL ELSE active_project_id END,
                updated_at = now()
            WHERE workspace_id = $2
              AND (last_opened_project_id = $1 OR active_project_id = $1)
              AND EXISTS (SELECT 1 FROM deleted_project)
          )
          SELECT EXISTS (SELECT 1 FROM deleted_project) AS deleted
        `,
        [projectId, actor.workspaceId],
      );

      if (!result.rows[0]?.deleted) {
        projectNotFound();
      }

      return { ok: true };
    },
  };
}
