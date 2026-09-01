import { createHmac } from "node:crypto";
import type {
  CreateOfficialImageTaskRequest,
  CreditBalance,
  CreditLedgerPage,
  OfficialGenerationPreferences,
  OfficialGenerationTask,
  OfficialGenerationTaskPage,
  OfficialGenerationTaskResponse,
  OfficialModelsResponse,
  RedeemCreditCodeRequest,
  RedeemCreditCodeResponse,
  UpdateOfficialGenerationPreferencesRequest,
} from "@ai-canvas-cloud/contracts";
import type { DbClient, DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import { AuthServiceError } from "../auth/service.js";
import type { ProjectActor } from "../projects/service.js";
import { sealSecret, type SecretKeyring } from "./crypto.js";

interface AccountRow {
  available_balance: number;
  reserved_balance: number;
  updated_at: Date | string;
}

interface TaskRow {
  id: string;
  client_task_id: string;
  project_id: string;
  model_id: string;
  model_public_name: string;
  resolution: "1K" | "2K" | "4K";
  price: number;
  operation_type: "generate" | "edit";
  status: OfficialGenerationTask["status"];
  failure_category: string | null;
  result_asset_id: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

export interface OfficialGenerationService {
  getPreferences(actor: ProjectActor): Promise<OfficialGenerationPreferences>;
  updatePreferences(
    input: UpdateOfficialGenerationPreferencesRequest,
    actor: ProjectActor,
  ): Promise<OfficialGenerationPreferences>;
  listModels(actor: ProjectActor): Promise<OfficialModelsResponse>;
  getBalance(actor: ProjectActor): Promise<CreditBalance>;
  listLedger(
    actor: ProjectActor,
    cursor?: string | null,
  ): Promise<CreditLedgerPage>;
  redeem(
    input: RedeemCreditCodeRequest,
    actor: ProjectActor,
  ): Promise<RedeemCreditCodeResponse>;
  createTask(
    input: CreateOfficialImageTaskRequest,
    actor: ProjectActor,
  ): Promise<OfficialGenerationTaskResponse>;
  listTasks(
    actor: ProjectActor,
    cursor?: string | null,
  ): Promise<OfficialGenerationTaskPage>;
  getTask(
    taskId: string,
    actor: ProjectActor,
  ): Promise<OfficialGenerationTaskResponse>;
  cancelTask(
    taskId: string,
    actor: ProjectActor,
  ): Promise<OfficialGenerationTaskResponse>;
  acknowledgeTask(
    taskId: string,
    actor: ProjectActor,
  ): Promise<OfficialGenerationTaskResponse>;
}

function error(
  statusCode: number,
  apiCode: ConstructorParameters<typeof AuthServiceError>[0]["apiCode"],
  message: string,
): never {
  throw new AuthServiceError({ statusCode, apiCode, message });
}

function iso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null) {
  return value ? iso(value) : null;
}

function toBalance(row: AccountRow): CreditBalance {
  return {
    available: Number(row.available_balance),
    reserved: Number(row.reserved_balance),
    updatedAt: iso(row.updated_at),
  };
}

function toTask(row: TaskRow): OfficialGenerationTask {
  return {
    id: row.id,
    clientTaskId: row.client_task_id,
    projectId: row.project_id,
    modelId: row.model_id,
    modelName: row.model_public_name,
    resolution: row.resolution,
    price: Number(row.price),
    operationType: row.operation_type,
    status: row.status,
    failureCategory: row.failure_category,
    resultAssetId: row.result_asset_id,
    createdAt: iso(row.created_at),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at),
  };
}

async function platformEnabled(database: Pick<DbPool | DbClient, "query">) {
  const result = await database.query<{ enabled: boolean }>(`
    SELECT COALESCE(
      (config_json #>> '{features,officialGenerationEnabled}')::boolean,
      false
    ) AS enabled
    FROM site_config_publications
    WHERE singleton_id = 1
  `);
  return result.rows[0]?.enabled === true;
}

async function userEnabled(
  database: Pick<DbPool | DbClient, "query">,
  userId: string,
) {
  const result = await database.query<{ enabled: boolean }>(
    `
    SELECT official_generation_enabled AS enabled
    FROM user_feature_preferences
    WHERE user_id = $1
  `,
    [userId],
  );
  return result.rows[0]?.enabled === true;
}

async function preferences(
  database: Pick<DbPool | DbClient, "query">,
  userId: string,
) {
  const [platform, user] = await Promise.all([
    platformEnabled(database),
    userEnabled(database, userId),
  ]);
  return {
    platformEnabled: platform,
    userEnabled: user,
    effectiveEnabled: platform && user,
  };
}

async function ensureAccount(client: DbClient, userId: string) {
  const inserted = await client.query<{ created_at: Date | string }>(
    `
    INSERT INTO credit_accounts (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING created_at
  `,
    [userId],
  );

  if (inserted.rowCount === 1) {
    const eligibility = await client.query<{
      signup_bonus: number;
      signup_bonus_enabled_at: Date | string | null;
      user_created_at: Date | string;
    }>(
      `
      SELECT cs.signup_bonus, cs.signup_bonus_enabled_at,
             u.created_at AS user_created_at
      FROM credit_settings cs
      CROSS JOIN "user" u
      WHERE cs.singleton = true AND u.id = $1
    `,
      [userId],
    );
    const row = eligibility.rows[0];
    if (
      row &&
      Number(row.signup_bonus) > 0 &&
      row.signup_bonus_enabled_at &&
      new Date(row.user_created_at).getTime() >=
        new Date(row.signup_bonus_enabled_at).getTime()
    ) {
      const amount = Number(row.signup_bonus);
      await client.query(
        `
        UPDATE credit_accounts
        SET available_balance = available_balance + $2, updated_at = now()
        WHERE user_id = $1
      `,
        [userId, amount],
      );
      await client.query(
        `
        INSERT INTO credit_ledger_entries (
          user_id, entry_type, available_delta, reserved_delta,
          available_balance, reserved_balance, reference_type, reference_id, public_note
        ) VALUES ($1, 'signup_bonus', $2, 0, $2, 0, 'user', $1, '注册赠送')
        ON CONFLICT DO NOTHING
      `,
        [userId, amount],
      );
    }
  }

  const account = await client.query<AccountRow>(
    `
    SELECT available_balance, reserved_balance, updated_at
    FROM credit_accounts WHERE user_id = $1 FOR UPDATE
  `,
    [userId],
  );
  return account.rows[0]!;
}

function normalizedCode(value: string) {
  return value.trim().toUpperCase().replaceAll("-", "");
}

function cursor(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as {
      createdAt?: string;
      id?: string;
    };
    if (!parsed.createdAt || !parsed.id) throw new Error();
    return parsed;
  } catch {
    return error(400, "VALIDATION_FAILED", "Cursor is invalid");
  }
}

function nextCursor(
  row: { created_at: Date | string; id: string } | undefined,
) {
  return row
    ? Buffer.from(
        JSON.stringify({ createdAt: iso(row.created_at), id: row.id }),
      ).toString("base64url")
    : null;
}

const TASK_SELECT = `
  SELECT id::text, client_task_id::text, project_id::text, model_id::text,
         model_public_name, resolution, price, operation_type, status,
         failure_category, result_asset_id::text, created_at, started_at, completed_at
  FROM official_generation_tasks
`;

export function createPostgresOfficialGenerationService(
  pool: DbPool,
  options: { keyring: SecretKeyring; redemptionCodePepper: string },
): OfficialGenerationService {
  async function balanceFor(
    database: Pick<DbPool | DbClient, "query">,
    userId: string,
  ) {
    const result = await database.query<AccountRow>(
      `
      SELECT available_balance, reserved_balance, updated_at
      FROM credit_accounts WHERE user_id = $1
    `,
      [userId],
    );
    if (result.rows[0]) return toBalance(result.rows[0]);
    return withTransaction(pool, async (client) =>
      toBalance(await ensureAccount(client, userId)),
    );
  }

  async function ownedTask(
    database: Pick<DbPool | DbClient, "query">,
    taskId: string,
    userId: string,
    lock = false,
  ) {
    const result = await database.query<TaskRow>(
      `${TASK_SELECT}
      WHERE id = $1 AND user_id = $2 ${lock ? "FOR UPDATE" : ""}
    `,
      [taskId, userId],
    );
    if (!result.rows[0])
      return error(404, "RESOURCE_NOT_FOUND", "Official task was not found");
    return result.rows[0];
  }

  return {
    getPreferences(actor) {
      return preferences(pool, actor.userId);
    },

    async updatePreferences(input, actor) {
      if (input.enabled && !(await platformEnabled(pool))) {
        return error(
          409,
          "OFFICIAL_GENERATION_DISABLED",
          "Official generation is not enabled by the platform",
        );
      }
      await pool.query(
        `
        INSERT INTO user_feature_preferences (user_id, official_generation_enabled)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE
        SET official_generation_enabled = EXCLUDED.official_generation_enabled,
            updated_at = now()
      `,
        [actor.userId, input.enabled],
      );
      return preferences(pool, actor.userId);
    },

    async listModels(actor) {
      const prefs = await preferences(pool, actor.userId);
      const result = prefs.effectiveEnabled
        ? await pool.query<{
            id: string;
            public_name: string;
            supports_generate: boolean;
            supports_edit: boolean;
            supports_references: boolean;
            price_1k: number | null;
            price_2k: number | null;
            price_4k: number | null;
          }>(`
            SELECT id::text, public_name, supports_generate, supports_edit,
                   supports_references, price_1k, price_2k, price_4k
            FROM official_models WHERE status = 'active' ORDER BY created_at, id
          `)
        : { rows: [] };
      return {
        preferences: prefs,
        models: result.rows.map((row) => ({
          id: row.id,
          name: row.public_name,
          capabilities: {
            generate: row.supports_generate,
            edit: row.supports_edit,
            references: row.supports_references,
          },
          prices: {
            "1K": row.price_1k,
            "2K": row.price_2k,
            "4K": row.price_4k,
          },
        })),
      };
    },

    async getBalance(actor) {
      return balanceFor(pool, actor.userId);
    },

    async listLedger(actor, rawCursor) {
      await balanceFor(pool, actor.userId);
      const decoded = cursor(rawCursor);
      const result = await pool.query<{
        id: string;
        entry_type: CreditLedgerPage["items"][number]["type"];
        available_delta: number;
        reserved_delta: number;
        available_balance: number;
        reserved_balance: number;
        reference_type: string | null;
        reference_id: string | null;
        public_note: string | null;
        created_at: Date | string;
      }>(
        `
        SELECT id::text, entry_type, available_delta, reserved_delta,
               available_balance, reserved_balance, reference_type, reference_id,
               public_note, created_at
        FROM credit_ledger_entries
        WHERE user_id = $1
          AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
        ORDER BY created_at DESC, id DESC LIMIT 51
      `,
        [actor.userId, decoded?.createdAt ?? null, decoded?.id ?? null],
      );
      const hasMore = result.rows.length > 50;
      const rows = result.rows.slice(0, 50);
      return {
        items: rows.map((row) => ({
          id: row.id,
          type: row.entry_type,
          availableDelta: Number(row.available_delta),
          reservedDelta: Number(row.reserved_delta),
          availableBalance: Number(row.available_balance),
          reservedBalance: Number(row.reserved_balance),
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          note: row.public_note,
          createdAt: iso(row.created_at),
        })),
        nextCursor: hasMore ? nextCursor(rows.at(-1)) : null,
      };
    },

    async redeem(input, actor) {
      const code = normalizedCode(input.code);
      if (!/^[A-Z0-9]{16,64}$/.test(code)) {
        return error(
          400,
          "REDEMPTION_CODE_INVALID",
          "Redemption code is invalid",
        );
      }
      const digest = createHmac("sha256", options.redemptionCodePepper)
        .update(code)
        .digest("hex");
      return withTransaction(pool, async (client) => {
        await ensureAccount(client, actor.userId);
        const found = await client.query<{
          id: string;
          credit_amount: number;
          status: "active" | "revoked";
          expires_at: Date | string | null;
          redeemed_by_user_id: string | null;
          redeem_idempotency_key: string | null;
        }>(
          `
          SELECT c.id::text, b.credit_amount, b.status, b.expires_at,
                 c.redeemed_by_user_id, c.redeem_idempotency_key
          FROM redemption_codes c
          JOIN redemption_code_batches b ON b.id = c.batch_id
          WHERE c.code_digest = $1 FOR UPDATE OF c, b
        `,
          [digest],
        );
        const row = found.rows[0];
        if (!row || row.status !== "active")
          return error(
            400,
            "REDEMPTION_CODE_INVALID",
            "Redemption code is invalid",
          );
        if (
          row.expires_at &&
          new Date(row.expires_at).getTime() <= Date.now()
        ) {
          return error(
            409,
            "REDEMPTION_CODE_EXPIRED",
            "Redemption code has expired",
          );
        }
        if (row.redeemed_by_user_id) {
          if (
            row.redeemed_by_user_id === actor.userId &&
            row.redeem_idempotency_key === input.idempotencyKey
          ) {
            return {
              credited: Number(row.credit_amount),
              balance: await balanceFor(client, actor.userId),
            };
          }
          return error(
            409,
            "REDEMPTION_CODE_REDEEMED",
            "Redemption code has already been used",
          );
        }
        const amount = Number(row.credit_amount);
        const account = await client.query<AccountRow>(
          `
          UPDATE credit_accounts SET available_balance = available_balance + $2, updated_at = now()
          WHERE user_id = $1
          RETURNING available_balance, reserved_balance, updated_at
        `,
          [actor.userId, amount],
        );
        await client.query(
          `
          UPDATE redemption_codes
          SET redeemed_by_user_id = $2, redeem_idempotency_key = $3, redeemed_at = now()
          WHERE id = $1
        `,
          [row.id, actor.userId, input.idempotencyKey],
        );
        await client.query(
          `
          UPDATE redemption_code_batches SET redeemed_count = redeemed_count + 1
          WHERE id = (SELECT batch_id FROM redemption_codes WHERE id = $1)
        `,
          [row.id],
        );
        await client.query(
          `
          INSERT INTO credit_ledger_entries (
            user_id, entry_type, available_delta, reserved_delta,
            available_balance, reserved_balance, reference_type, reference_id, public_note
          ) VALUES ($1, 'redemption', $2, 0, $3, $4, 'redemption_code', $5, '兑换码')
        `,
          [
            actor.userId,
            amount,
            account.rows[0]!.available_balance,
            account.rows[0]!.reserved_balance,
            row.id,
          ],
        );
        return { credited: amount, balance: toBalance(account.rows[0]!) };
      });
    },

    async createTask(input, actor) {
      return withTransaction(pool, async (client) => {
        const prefs = await preferences(client, actor.userId);
        if (!prefs.effectiveEnabled)
          return error(
            409,
            "OFFICIAL_GENERATION_DISABLED",
            "Official generation is disabled",
          );
        const account = await ensureAccount(client, actor.userId);
        const existing = await client.query<TaskRow>(
          `${TASK_SELECT}
          WHERE user_id = $1 AND (client_task_id = $2 OR idempotency_key = $3)
          LIMIT 1 FOR UPDATE
        `,
          [actor.userId, input.clientTaskId, input.idempotencyKey],
        );
        if (existing.rows[0]) {
          return {
            task: toTask(existing.rows[0]),
            balance: toBalance(account),
          };
        }
        const project = await client.query(
          `
          SELECT 1 FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = $1 AND p.workspace_id = $2 AND wm.user_id = $3
            AND wm.role IN ('owner', 'admin', 'editor')
            AND p.deleted_at IS NULL
        `,
          [input.projectId, actor.workspaceId, actor.userId],
        );
        if (project.rowCount !== 1)
          return error(404, "RESOURCE_NOT_FOUND", "Project was not found");
        const model = await client.query<{
          id: string;
          provider_revision_id: string;
          public_name: string;
          upstream_model_id: string;
          supports_generate: boolean;
          supports_edit: boolean;
          supports_references: boolean;
          price: number | null;
        }>(
          `
          SELECT id::text, provider_revision_id::text, public_name, upstream_model_id,
                 supports_generate, supports_edit, supports_references,
                 CASE $2 WHEN '1K' THEN price_1k WHEN '2K' THEN price_2k WHEN '4K' THEN price_4k END AS price
          FROM official_models WHERE id = $1 AND status = 'active'
        `,
          [input.modelId, input.resolution],
        );
        const selected = model.rows[0];
        if (!selected || !selected.price)
          return error(
            409,
            "OFFICIAL_MODEL_UNAVAILABLE",
            "Official model or resolution is unavailable",
          );
        if (input.operationType === "edit" && !selected.supports_edit)
          return error(
            409,
            "OFFICIAL_MODEL_UNAVAILABLE",
            "Official model does not support editing",
          );
        if (input.operationType === "generate" && !selected.supports_generate)
          return error(
            409,
            "OFFICIAL_MODEL_UNAVAILABLE",
            "Official model does not support generation",
          );
        const assetIds = [
          ...new Set(
            [
              ...(input.inputAssetIds ?? []),
              input.editAssetId,
              input.maskAssetId,
            ].filter((value): value is string => Boolean(value)),
          ),
        ];
        if (assetIds.length > 0) {
          if (
            !selected.supports_references &&
            (input.inputAssetIds?.length ?? 0) > 0
          ) {
            return error(
              409,
              "OFFICIAL_MODEL_UNAVAILABLE",
              "Official model does not support reference images",
            );
          }
          const assets = await client.query<{ id: string }>(
            `
            SELECT id::text FROM assets
            WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'completed'
              AND deleted_at IS NULL AND mime_type LIKE 'image/%'
          `,
            [actor.workspaceId, assetIds],
          );
          if (assets.rowCount !== assetIds.length)
            return error(
              403,
              "OFFICIAL_INPUT_ASSET_NOT_ALLOWED",
              "One or more input assets are not allowed",
            );
        }
        const price = Number(selected.price);
        if (Number(account.available_balance) < price)
          return error(
            409,
            "CREDIT_INSUFFICIENT",
            "Available credits are insufficient",
          );
        const updated = await client.query<AccountRow>(
          `
          UPDATE credit_accounts
          SET available_balance = available_balance - $2,
              reserved_balance = reserved_balance + $2,
              updated_at = now()
          WHERE user_id = $1
          RETURNING available_balance, reserved_balance, updated_at
        `,
          [actor.userId, price],
        );
        const inserted = await client.query<TaskRow>(
          `
          INSERT INTO official_generation_tasks (
            workspace_id, project_id, user_id, client_task_id, idempotency_key,
            model_id, provider_revision_id, model_public_name, upstream_model_id,
            resolution, price, operation_type, request_envelope, input_asset_ids
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::uuid[])
          RETURNING id::text, client_task_id::text, project_id::text, model_id::text,
                    model_public_name, resolution, price, operation_type, status,
                    failure_category, result_asset_id::text, created_at, started_at, completed_at
        `,
          [
            actor.workspaceId,
            input.projectId,
            actor.userId,
            input.clientTaskId,
            input.idempotencyKey,
            selected.id,
            selected.provider_revision_id,
            selected.public_name,
            selected.upstream_model_id,
            input.resolution,
            price,
            input.operationType,
            JSON.stringify(sealSecret(input, options.keyring)),
            assetIds,
          ],
        );
        const task = inserted.rows[0]!;
        await client.query(
          `
          INSERT INTO credit_ledger_entries (
            user_id, entry_type, available_delta, reserved_delta,
            available_balance, reserved_balance, reference_type, reference_id, public_note
          ) VALUES ($1, 'generation_reserve', $2, $3, $4, $5, 'official_task', $6, '官方生成预留')
        `,
          [
            actor.userId,
            -price,
            price,
            updated.rows[0]!.available_balance,
            updated.rows[0]!.reserved_balance,
            task.id,
          ],
        );
        return { task: toTask(task), balance: toBalance(updated.rows[0]!) };
      });
    },

    async listTasks(actor, rawCursor) {
      const decoded = cursor(rawCursor);
      const result = await pool.query<TaskRow>(
        `${TASK_SELECT}
        WHERE user_id = $1 AND workspace_id = $2
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid))
        ORDER BY created_at DESC, id DESC LIMIT 51
      `,
        [
          actor.userId,
          actor.workspaceId,
          decoded?.createdAt ?? null,
          decoded?.id ?? null,
        ],
      );
      const hasMore = result.rows.length > 50;
      const rows = result.rows.slice(0, 50);
      return {
        items: rows.map(toTask),
        nextCursor: hasMore ? nextCursor(rows.at(-1)) : null,
      };
    },

    async getTask(taskId, actor) {
      return {
        task: toTask(await ownedTask(pool, taskId, actor.userId)),
        balance: await balanceFor(pool, actor.userId),
      };
    },

    async cancelTask(taskId, actor) {
      return withTransaction(pool, async (client) => {
        const task = await ownedTask(client, taskId, actor.userId, true);
        if (task.status !== "queued")
          return error(
            409,
            "OFFICIAL_TASK_STATE_INVALID",
            "Only queued official tasks can be canceled",
          );
        await client.query(
          `
          UPDATE official_generation_tasks
          SET status = 'canceled', billing_status = 'released', request_envelope = NULL,
              completed_at = now(), updated_at = now()
          WHERE id = $1
        `,
          [task.id],
        );
        const account = await client.query<AccountRow>(
          `
          UPDATE credit_accounts
          SET available_balance = available_balance + $2,
              reserved_balance = reserved_balance - $2,
              updated_at = now()
          WHERE user_id = $1
          RETURNING available_balance, reserved_balance, updated_at
        `,
          [actor.userId, task.price],
        );
        await client.query(
          `
          INSERT INTO credit_ledger_entries (
            user_id, entry_type, available_delta, reserved_delta,
            available_balance, reserved_balance, reference_type, reference_id, public_note
          ) VALUES ($1, 'generation_release', $2, $3, $4, $5, 'official_task', $6, '排队任务取消')
        `,
          [
            actor.userId,
            task.price,
            -task.price,
            account.rows[0]!.available_balance,
            account.rows[0]!.reserved_balance,
            task.id,
          ],
        );
        return {
          task: toTask({
            ...task,
            status: "canceled",
            completed_at: new Date(),
          }),
          balance: toBalance(account.rows[0]!),
        };
      });
    },

    async acknowledgeTask(taskId, actor) {
      const task = await ownedTask(pool, taskId, actor.userId);
      if (task.status !== "succeeded")
        return error(
          409,
          "OFFICIAL_TASK_STATE_INVALID",
          "Only succeeded official tasks can be acknowledged",
        );
      await pool.query(
        `
        UPDATE official_generation_tasks SET acknowledged_at = COALESCE(acknowledged_at, now()), updated_at = now()
        WHERE id = $1 AND user_id = $2
      `,
        [task.id, actor.userId],
      );
      return {
        task: toTask(task),
        balance: await balanceFor(pool, actor.userId),
      };
    },
  };
}

export function createUnavailableOfficialGenerationService(): OfficialGenerationService {
  const unavailable = async (): Promise<never> =>
    error(
      503,
      "SERVICE_UNAVAILABLE",
      "Official generation service is unavailable",
    );
  return {
    getPreferences: unavailable,
    updatePreferences: unavailable,
    listModels: unavailable,
    getBalance: unavailable,
    listLedger: unavailable,
    redeem: unavailable,
    createTask: unavailable,
    listTasks: unavailable,
    getTask: unavailable,
    cancelTask: unavailable,
    acknowledgeTask: unavailable,
  };
}
