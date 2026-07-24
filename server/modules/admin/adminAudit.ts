import type { DbClient, DbPool } from "../../db/postgres.js";
import {
  hashAdminRequestIdentity,
  redactAdminAuditPayload,
} from "./security.js";
import type { AdminAuditEventInput } from "./types.js";

export async function insertAdminAuditEvent(
  database: Pick<DbPool | DbClient, "query">,
  input: AdminAuditEventInput,
  pepper: string,
) {
  if (
    !/^[a-z0-9_.:-]{1,96}$/i.test(input.action) ||
    !/^.{1,128}$/.test(input.requestId)
  ) {
    throw new Error("Audit event identifiers are invalid");
  }
  await database.query(
    `
      INSERT INTO admin.audit_events (
        admin_user_id, admin_role, action, target_type, target_id, result,
        request_id, ip_hash, user_agent_hash, before_json, after_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
    `,
    [
      input.actor?.id ?? null,
      input.actor?.role ?? null,
      input.action,
      input.targetType?.slice(0, 64) ?? null,
      input.targetId?.slice(0, 128) ?? null,
      input.result,
      input.requestId,
      hashAdminRequestIdentity(input.ipAddress, pepper),
      hashAdminRequestIdentity(input.userAgent, pepper),
      JSON.stringify(redactAdminAuditPayload(input.before)),
      JSON.stringify(redactAdminAuditPayload(input.after)),
    ],
  );
}
