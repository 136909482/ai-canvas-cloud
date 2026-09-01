/* eslint-disable @typescript-eslint/no-explicit-any -- SQL result rows are projected immediately into public DTOs. */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type {
  AdminCreateOfficialProviderRequest,
  AdminCreateRedemptionBatchRequest,
  AdminCreatedRedemptionBatch,
  AdminCreditAdjustmentRequest,
  AdminCreditSettings,
  AdminOfficialModel,
  AdminOfficialProviderSummary,
  AdminOfficialProviderModelOption,
  AdminRedemptionBatch,
  AdminUpdateCreditSettingsRequest,
  AdminUpsertOfficialModelRequest,
  CreditBalance,
  CreditLedgerPage,
} from "@ai-canvas-cloud/contracts";
import type { DbClient, DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import {
  openSecret,
  sealSecret,
  type SecretEnvelope,
  type SecretKeyring,
} from "../official-generation/crypto.js";
import { insertAdminAuditEvent } from "./adminAudit.js";
import { AdminAccessError } from "./security.js";
import type { AdminRequestContext } from "./types.js";
import type { AdminService } from "./service.js";

export interface AdminOfficialGenerationService {
  listProviders(
    context: AdminRequestContext,
  ): Promise<{ items: AdminOfficialProviderSummary[] }>;
  createProvider(
    input: AdminCreateOfficialProviderRequest,
    context: AdminRequestContext,
  ): Promise<AdminOfficialProviderSummary>;
  testProvider(
    providerId: string,
    context: AdminRequestContext,
  ): Promise<{ ok: true }>;
  listProviderModels(
    providerId: string,
    context: AdminRequestContext,
  ): Promise<{ items: AdminOfficialProviderModelOption[] }>;
  listModels(
    context: AdminRequestContext,
  ): Promise<{ items: AdminOfficialModel[] }>;
  createModel(
    input: AdminUpsertOfficialModelRequest,
    context: AdminRequestContext,
  ): Promise<AdminOfficialModel>;
  updateModel(
    modelId: string,
    input: AdminUpsertOfficialModelRequest,
    context: AdminRequestContext,
  ): Promise<AdminOfficialModel>;
  getCreditSettings(context: AdminRequestContext): Promise<AdminCreditSettings>;
  updateCreditSettings(
    input: AdminUpdateCreditSettingsRequest,
    context: AdminRequestContext,
  ): Promise<AdminCreditSettings>;
  listRedemptionBatches(
    context: AdminRequestContext,
  ): Promise<{ items: AdminRedemptionBatch[] }>;
  createRedemptionBatch(
    input: AdminCreateRedemptionBatchRequest,
    context: AdminRequestContext,
  ): Promise<AdminCreatedRedemptionBatch>;
  revokeRedemptionBatch(
    batchId: string,
    context: AdminRequestContext,
  ): Promise<AdminRedemptionBatch>;
  getUserCredits(
    userId: string,
    context: AdminRequestContext,
  ): Promise<{ balance: CreditBalance; entries: CreditLedgerPage["items"] }>;
  adjustUserCredits(
    userId: string,
    input: AdminCreditAdjustmentRequest,
    context: AdminRequestContext,
  ): Promise<{ balance: CreditBalance }>;
}

function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function safeBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "Provider URL is invalid",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "Provider URL must be a credential-free HTTPS URL",
    );
  }
  const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
  if (
    addresses.length === 0 ||
    addresses.some((item) => privateAddress(item.address))
  ) {
    throw new AdminAccessError(
      400,
      "VALIDATION_FAILED",
      "Provider host is not allowed",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}
function balance(row: {
  available_balance: number;
  reserved_balance: number;
  updated_at: Date | string;
}): CreditBalance {
  return {
    available: Number(row.available_balance),
    reserved: Number(row.reserved_balance),
    updatedAt: iso(row.updated_at),
  };
}
function provider(row: any): AdminOfficialProviderSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    protocol: row.protocol,
    baseUrl: row.base_url,
    credentialsConfigured: true,
    createdAt: iso(row.created_at),
  };
}
function model(row: any): AdminOfficialModel {
  return {
    id: row.id,
    name: row.public_name,
    providerRevisionId: row.provider_revision_id,
    providerName: row.provider_name,
    upstreamModelId: row.upstream_model_id,
    capabilities: {
      generate: row.supports_generate,
      edit: row.supports_edit,
      references: row.supports_references,
    },
    prices: { "1K": row.price_1k, "2K": row.price_2k, "4K": row.price_4k },
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function batch(row: any): AdminRedemptionBatch {
  return {
    id: row.id,
    creditAmount: Number(row.credit_amount),
    codeCount: Number(row.code_count),
    redeemedCount: Number(row.redeemed_count),
    expiresAt: row.expires_at ? iso(row.expires_at) : null,
    note: row.note,
    status: row.status,
    createdAt: iso(row.created_at),
  };
}
function generatedCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  const raw = `AIC${[...bytes].map((value) => alphabet[value % alphabet.length]).join("")}`;
  return raw.match(/.{1,4}/g)!.join("-");
}
function normalizedCode(value: string) {
  return value.replaceAll("-", "");
}

const MODEL_SELECT = `
  SELECT m.id::text, m.provider_revision_id::text, p.display_name AS provider_name,
         m.public_name, m.upstream_model_id, m.supports_generate, m.supports_edit,
         m.supports_references, m.price_1k, m.price_2k, m.price_4k,
         m.status, m.created_at, m.updated_at
  FROM public.official_models m
  JOIN public.official_provider_revisions p ON p.id = m.provider_revision_id
`;

export function createPostgresAdminOfficialGenerationService(
  pool: DbPool,
  options: {
    adminService: AdminService;
    keyring: SecretKeyring;
    redemptionCodePepper: string;
    auditSecret: string;
  },
): AdminOfficialGenerationService {
  async function settings() {
    const result = await pool.query<any>(`
      SELECT signup_bonus, signup_bonus_enabled_at, updated_at
      FROM public.credit_settings WHERE singleton = true
    `);
    const row = result.rows[0];
    return {
      signupBonus: Number(row.signup_bonus),
      signupBonusEnabledAt: row.signup_bonus_enabled_at
        ? iso(row.signup_bonus_enabled_at)
        : null,
      updatedAt: iso(row.updated_at),
    };
  }
  async function findModel(id: string) {
    const result = await pool.query<any>(`${MODEL_SELECT} WHERE m.id = $1`, [
      id,
    ]);
    if (!result.rows[0])
      throw new AdminAccessError(
        404,
        "RESOURCE_NOT_FOUND",
        "Official model was not found",
      );
    return model(result.rows[0]);
  }
  async function findBatch(id: string) {
    const result = await pool.query<any>(
      `SELECT id::text, credit_amount, code_count, redeemed_count, expires_at, note, status, created_at FROM public.redemption_code_batches WHERE id = $1`,
      [id],
    );
    if (!result.rows[0])
      throw new AdminAccessError(
        404,
        "RESOURCE_NOT_FOUND",
        "Redemption batch was not found",
      );
    return batch(result.rows[0]);
  }
  async function ensureAdminAccount(client: DbClient, userId: string) {
    const user = await client.query<{ created_at: Date | string }>(
      `SELECT created_at FROM public."user" WHERE id = $1 AND status <> 'deleted'`,
      [userId],
    );
    if (user.rowCount !== 1)
      throw new AdminAccessError(
        404,
        "RESOURCE_NOT_FOUND",
        "User was not found",
      );
    const inserted = await client.query(
      `INSERT INTO public.credit_accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING user_id`,
      [userId],
    );
    if (inserted.rowCount !== 1) return;
    const creditSettings = await client.query<{
      signup_bonus: number;
      signup_bonus_enabled_at: Date | string | null;
    }>(
      `SELECT signup_bonus, signup_bonus_enabled_at FROM public.credit_settings WHERE singleton = true`,
    );
    const setting = creditSettings.rows[0];
    if (
      setting &&
      Number(setting.signup_bonus) > 0 &&
      setting.signup_bonus_enabled_at &&
      new Date(user.rows[0]!.created_at).getTime() >=
        new Date(setting.signup_bonus_enabled_at).getTime()
    ) {
      const amount = Number(setting.signup_bonus);
      await client.query(
        `UPDATE public.credit_accounts SET available_balance=$2,updated_at=now() WHERE user_id=$1`,
        [userId, amount],
      );
      await client.query(
        `INSERT INTO public.credit_ledger_entries (user_id,entry_type,available_delta,reserved_delta,available_balance,reserved_balance,reference_type,reference_id,public_note) VALUES ($1,'signup_bonus',$2,0,$2,0,'user',$1,'注册赠送') ON CONFLICT DO NOTHING`,
        [userId, amount],
      );
    }
  }

  return {
    async listProviders(context) {
      await options.adminService.requirePermission(
        context,
        "official_generation.write",
      );
      const result = await pool.query<any>(
        `SELECT id::text, display_name, protocol, base_url, created_at FROM public.official_provider_revisions ORDER BY created_at DESC`,
      );
      return { items: result.rows.map(provider) };
    },
    async createProvider(input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "official_generation.write",
      );
      const id = randomUUID();
      const baseUrl = await safeBaseUrl(input.baseUrl);
      const result = await withTransaction(pool, async (client) => {
        const inserted = await client.query<any>(
          `
          INSERT INTO public.official_provider_revisions
            (id, display_name, protocol, base_url, credential_envelope, created_by_admin_id)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6)
          RETURNING id::text, display_name, protocol, base_url, created_at
        `,
          [
            id,
            input.displayName.trim(),
            input.protocol,
            baseUrl,
            JSON.stringify(
              sealSecret({ apiKey: input.apiKey }, options.keyring),
            ),
            session.admin.id,
          ],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.official_provider.created",
            targetType: "official_provider_revision",
            targetId: id,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: {
              protocol: input.protocol,
              baseUrl: new URL(baseUrl).origin,
            },
          },
          options.auditSecret,
        );
        return inserted.rows[0];
      });
      return provider(result);
    },
    async testProvider(providerId, context) {
      await options.adminService.requirePermission(
        context,
        "official_generation.write",
      );
      const result = await pool.query<{
        base_url: string;
        credential_envelope: SecretEnvelope;
      }>(
        `SELECT base_url,credential_envelope FROM public.official_provider_revisions WHERE id = $1`,
        [providerId],
      );
      if (!result.rows[0])
        throw new AdminAccessError(
          404,
          "RESOURCE_NOT_FOUND",
          "Official provider was not found",
        );
      const baseUrl = await safeBaseUrl(result.rows[0].base_url);
      const { apiKey } = openSecret<{ apiKey: string }>(
        result.rows[0].credential_envelope,
        options.keyring,
      );
      const probeUrl = new URL(baseUrl);
      probeUrl.pathname = `${probeUrl.pathname.replace(/\/$/, "")}/models`;
      const response = await fetch(probeUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      const contentLength = Number(
        response?.headers.get("content-length") ?? 0,
      );
      if (!response?.ok || contentLength > 1024 * 1024) {
        await response?.body?.cancel().catch(() => undefined);
        throw new AdminAccessError(
          409,
          "VALIDATION_FAILED",
          "Provider connection or authentication test failed",
        );
      }
      await response.body?.cancel().catch(() => undefined);
      return { ok: true };
    },
    async listProviderModels(providerId, context) {
      await options.adminService.requirePermission(
        context,
        "official_generation.write",
      );
      const result = await pool.query<{
        base_url: string;
        credential_envelope: SecretEnvelope;
      }>(
        `SELECT base_url, credential_envelope FROM public.official_provider_revisions WHERE id = $1`,
        [providerId],
      );
      if (!result.rows[0])
        throw new AdminAccessError(
          404,
          "RESOURCE_NOT_FOUND",
          "Official provider was not found",
        );
      const { apiKey } = openSecret<{ apiKey: string }>(
        result.rows[0].credential_envelope,
        options.keyring,
      );
      const url = new URL(result.rows[0].base_url);
      const path = url.pathname.replace(/\/$/, "");
      url.pathname = path.endsWith("/v1")
        ? `${path}/models`
        : `${path}/v1/models`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      if (!response?.ok) {
        await response?.body?.cancel().catch(() => undefined);
        throw new AdminAccessError(
          409,
          "VALIDATION_FAILED",
          "Provider 模型目录获取失败",
        );
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > 1024 * 1024) {
        await response.body?.cancel().catch(() => undefined);
        throw new AdminAccessError(
          409,
          "VALIDATION_FAILED",
          "Provider 响应过大",
        );
      }
      const payload = (await response.json().catch(() => null)) as {
        data?: unknown[];
        models?: unknown[];
      } | null;
      await response.body?.cancel().catch(() => undefined);
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : [];
      const items = rows
        .map((item) => {
          if (typeof item === "string") return { id: item, name: null };
          if (!item || typeof item !== "object") return null;
          const value = item as {
            id?: unknown;
            name?: unknown;
            model?: unknown;
          };
          const id =
            typeof value.id === "string"
              ? value.id
              : typeof value.model === "string"
                ? value.model
                : "";
          return id
            ? {
                id: id.slice(0, 200),
                name:
                  typeof value.name === "string"
                    ? value.name.slice(0, 200)
                    : null,
              }
            : null;
        })
        .filter((item): item is AdminOfficialProviderModelOption =>
          Boolean(item),
        );
      return { items: items.slice(0, 500) };
    },
    async listModels(context) {
      await options.adminService.requirePermission(
        context,
        "official_generation.write",
      );
      const result = await pool.query<any>(
        `${MODEL_SELECT} ORDER BY m.created_at DESC`,
      );
      return { items: result.rows.map(model) };
    },
    async createModel(input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "official_generation.write",
      );
      const id = randomUUID();
      await withTransaction(pool, async (client) => {
        await client.query(
          `
          INSERT INTO public.official_models (
            id, provider_revision_id, public_name, upstream_model_id,
            supports_generate, supports_edit, supports_references,
            price_1k, price_2k, price_4k, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `,
          [
            id,
            input.providerRevisionId,
            input.publicName.trim(),
            input.upstreamModelId.trim(),
            input.capabilities.generate,
            input.capabilities.edit,
            input.capabilities.references,
            input.prices["1K"],
            input.prices["2K"],
            input.prices["4K"],
            input.status,
          ],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.official_model.created",
            targetType: "official_model",
            targetId: id,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: {
              publicName: input.publicName,
              prices: input.prices,
              status: input.status,
            },
          },
          options.auditSecret,
        );
      });
      return findModel(id);
    },
    async updateModel(modelId, input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "official_generation.write",
      );
      await withTransaction(pool, async (client) => {
        const result = await client.query(
          `
          UPDATE public.official_models SET provider_revision_id=$2, public_name=$3,
            upstream_model_id=$4, supports_generate=$5, supports_edit=$6,
            supports_references=$7, price_1k=$8, price_2k=$9, price_4k=$10,
            status=$11, updated_at=now() WHERE id=$1
        `,
          [
            modelId,
            input.providerRevisionId,
            input.publicName.trim(),
            input.upstreamModelId.trim(),
            input.capabilities.generate,
            input.capabilities.edit,
            input.capabilities.references,
            input.prices["1K"],
            input.prices["2K"],
            input.prices["4K"],
            input.status,
          ],
        );
        if (result.rowCount !== 1)
          throw new AdminAccessError(
            404,
            "RESOURCE_NOT_FOUND",
            "Official model was not found",
          );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.official_model.updated",
            targetType: "official_model",
            targetId: modelId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: {
              publicName: input.publicName,
              prices: input.prices,
              status: input.status,
            },
          },
          options.auditSecret,
        );
      });
      return findModel(modelId);
    },
    async getCreditSettings(context) {
      await options.adminService.requirePermission(context, "credit.read");
      return settings();
    },
    async updateCreditSettings(input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "credit.write",
      );
      await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE public.credit_settings SET signup_bonus=$1, signup_bonus_enabled_at=CASE WHEN $1=0 THEN NULL ELSE COALESCE(signup_bonus_enabled_at, now()) END, updated_by_admin_id=$2, updated_at=now() WHERE singleton=true`,
          [input.signupBonus, session.admin.id],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.credit_settings.updated",
            targetType: "credit_settings",
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: { signupBonus: input.signupBonus },
          },
          options.auditSecret,
        );
      });
      return settings();
    },
    async listRedemptionBatches(context) {
      await options.adminService.requirePermission(context, "credit.write");
      const result = await pool.query<any>(
        `SELECT id::text, credit_amount, code_count, redeemed_count, expires_at, note, status, created_at FROM public.redemption_code_batches ORDER BY created_at DESC LIMIT 100`,
      );
      return { items: result.rows.map(batch) };
    },
    async createRedemptionBatch(input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "credit.write",
      );
      const id = randomUUID();
      const codes = Array.from({ length: input.codeCount }, generatedCode);
      await withTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO public.redemption_code_batches (id,credit_amount,code_count,expires_at,note,created_by_admin_id) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            input.creditAmount,
            input.codeCount,
            input.expiresAt ?? null,
            input.note?.trim() || null,
            session.admin.id,
          ],
        );
        for (const code of codes) {
          const digest = createHmac("sha256", options.redemptionCodePepper)
            .update(normalizedCode(code))
            .digest("hex");
          await client.query(
            `INSERT INTO public.redemption_codes (batch_id,code_digest,code_suffix) VALUES ($1,$2,$3)`,
            [id, digest, normalizedCode(code).slice(-4)],
          );
        }
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.redemption_batch.created",
            targetType: "redemption_batch",
            targetId: id,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: {
              creditAmount: input.creditAmount,
              codeCount: input.codeCount,
              expiresAt: input.expiresAt ?? null,
            },
          },
          options.auditSecret,
        );
      });
      return { ...(await findBatch(id)), codes };
    },
    async revokeRedemptionBatch(batchId, context) {
      const session = await options.adminService.requirePermission(
        context,
        "credit.write",
      );
      await withTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE public.redemption_code_batches SET status='revoked' WHERE id=$1`,
          [batchId],
        );
        if (result.rowCount !== 1)
          throw new AdminAccessError(
            404,
            "RESOURCE_NOT_FOUND",
            "Redemption batch was not found",
          );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.redemption_batch.revoked",
            targetType: "redemption_batch",
            targetId: batchId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
          options.auditSecret,
        );
      });
      return findBatch(batchId);
    },
    async getUserCredits(userId, context) {
      await options.adminService.requirePermission(context, "credit.read");
      await withTransaction(pool, (client) =>
        ensureAdminAccount(client, userId),
      );
      const [account, entries] = await Promise.all([
        pool.query<any>(
          `SELECT available_balance,reserved_balance,updated_at FROM public.credit_accounts WHERE user_id=$1`,
          [userId],
        ),
        pool.query<any>(
          `SELECT id::text,entry_type,available_delta,reserved_delta,available_balance,reserved_balance,reference_type,reference_id,public_note,created_at FROM public.credit_ledger_entries WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`,
          [userId],
        ),
      ]);
      return {
        balance: balance(account.rows[0]),
        entries: entries.rows.map((row: any) => ({
          id: row.id,
          type: row.entry_type,
          availableDelta: row.available_delta,
          reservedDelta: row.reserved_delta,
          availableBalance: row.available_balance,
          reservedBalance: row.reserved_balance,
          referenceType: row.reference_type,
          referenceId: row.reference_id,
          note: row.public_note,
          createdAt: iso(row.created_at),
        })),
      };
    },
    async adjustUserCredits(userId, input, context) {
      const session = await options.adminService.requirePermission(
        context,
        "credit.write",
      );
      if (input.delta === 0)
        throw new AdminAccessError(
          400,
          "VALIDATION_FAILED",
          "Credit adjustment cannot be zero",
        );
      const updated = await withTransaction(pool, async (client) => {
        await ensureAdminAccount(client, userId);
        const account = await client.query<any>(
          `UPDATE public.credit_accounts SET available_balance=available_balance+$2,updated_at=now() WHERE user_id=$1 AND available_balance+$2>=0 RETURNING available_balance,reserved_balance,updated_at`,
          [userId, input.delta],
        );
        if (!account.rows[0])
          throw new AdminAccessError(
            409,
            "VALIDATION_FAILED",
            "Credit adjustment exceeds available balance",
          );
        const referenceId = randomUUID();
        await client.query(
          `INSERT INTO public.credit_ledger_entries (user_id,entry_type,available_delta,reserved_delta,available_balance,reserved_balance,reference_type,reference_id,public_note) VALUES ($1,'admin_adjustment',$2,0,$3,$4,'admin_adjustment',$5,'管理员调整')`,
          [
            userId,
            input.delta,
            account.rows[0].available_balance,
            account.rows[0].reserved_balance,
            referenceId,
          ],
        );
        await insertAdminAuditEvent(
          client,
          {
            actor: session.admin,
            action: "admin.user_credits.adjusted",
            targetType: "user",
            targetId: userId,
            result: "success",
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            after: { delta: input.delta, reason: input.reason.trim() },
          },
          options.auditSecret,
        );
        return account.rows[0];
      });
      return { balance: balance(updated) };
    },
  };
}

export function createUnavailableAdminOfficialGenerationService(): AdminOfficialGenerationService {
  const unavailable = async (): Promise<never> => {
    throw new AdminAccessError(
      503,
      "SERVICE_UNAVAILABLE",
      "Official generation administration is unavailable",
    );
  };
  return {
    listProviders: unavailable,
    createProvider: unavailable,
    testProvider: unavailable,
    listProviderModels: unavailable,
    listModels: unavailable,
    createModel: unavailable,
    updateModel: unavailable,
    getCreditSettings: unavailable,
    updateCreditSettings: unavailable,
    listRedemptionBatches: unavailable,
    createRedemptionBatch: unavailable,
    revokeRedemptionBatch: unavailable,
    getUserCredits: unavailable,
    adjustUserCredits: unavailable,
  };
}
