import type {
  WorkspaceRole,
  WorkspaceStatus,
  WorkspaceType,
} from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";

export interface WorkspaceAccess {
  workspace: {
    id: string;
    type: WorkspaceType;
    name: string;
    status: WorkspaceStatus;
    planKey: string;
    ownerUserId: string;
  };
  member: {
    userId: string;
    role: WorkspaceRole;
  };
}

export interface WorkspaceAuthorizationService {
  requireWorkspaceAccess: (input: {
    userId: string;
    workspaceId: string;
    allowedRoles?: readonly WorkspaceRole[];
  }) => Promise<WorkspaceAccess>;
}

interface WorkspaceAccessRow {
  workspace_id: string;
  workspace_type: WorkspaceType;
  workspace_name: string;
  workspace_status: WorkspaceStatus;
  plan_key: string;
  owner_user_id: string;
  member_user_id: string;
  member_role: WorkspaceRole;
}

function assertWorkspaceId(workspaceId: string) {
  if (!workspaceId.trim()) {
    throw new AuthServiceError({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
      message: "Workspace id is required",
    });
  }
}

function toWorkspaceAccess(row: WorkspaceAccessRow): WorkspaceAccess {
  return {
    workspace: {
      id: row.workspace_id,
      type: row.workspace_type,
      name: row.workspace_name,
      status: row.workspace_status,
      planKey: row.plan_key,
      ownerUserId: row.owner_user_id,
    },
    member: {
      userId: row.member_user_id,
      role: row.member_role,
    },
  };
}

export function createWorkspaceAuthorizationService(
  pool: Pick<DbPool, "query">,
): WorkspaceAuthorizationService {
  return {
    async requireWorkspaceAccess(input) {
      assertWorkspaceId(input.workspaceId);

      const result = await pool.query<WorkspaceAccessRow>(
        `
          SELECT
            w.id::text AS workspace_id,
            w.type AS workspace_type,
            w.name AS workspace_name,
            w.status AS workspace_status,
            w.plan_key,
            w.owner_user_id,
            wm.user_id AS member_user_id,
            wm.role AS member_role
          FROM workspaces w
          JOIN workspace_members wm ON wm.workspace_id = w.id
          JOIN "user" u ON u.id = wm.user_id
          WHERE w.id = $1
            AND wm.user_id = $2
            AND w.status <> 'deleted'
            AND COALESCE(u.status, 'active') = 'active'
          LIMIT 1
        `,
        [input.workspaceId, input.userId],
      );
      const row = result.rows[0];

      if (!row) {
        throw new AuthServiceError({
          statusCode: 404,
          apiCode: "RESOURCE_NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (row.workspace_status !== "active") {
        throw new AuthServiceError({
          statusCode: 403,
          apiCode: "ACCESS_DENIED",
          message: "Workspace is not active",
        });
      }

      if (input.allowedRoles && !input.allowedRoles.includes(row.member_role)) {
        throw new AuthServiceError({
          statusCode: 403,
          apiCode: "ACCESS_DENIED",
          message: "Workspace role is not allowed",
        });
      }

      return toWorkspaceAccess(row);
    },
  };
}
