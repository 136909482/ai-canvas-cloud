/* eslint-disable @typescript-eslint/no-explicit-any -- Provider JSON and SQL rows are validated before use. */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { CreateOfficialImageTaskRequest } from "@ai-canvas-cloud/contracts";
import type { DbPool } from "../../db/postgres.js";
import { withTransaction } from "../../db/postgres.js";
import {
  assertWorkspaceStorageCapacity,
  lockWorkspaceStorageQuota,
  readWorkspaceStorageUsage,
} from "../workspaces/usage.js";
import {
  openSecret,
  type SecretEnvelope,
  type SecretKeyring,
} from "./crypto.js";

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const CLAIM_TIMEOUT_MINUTES = 30;

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const value = address.toLowerCase();
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    /^fe[89ab]/.test(value)
  );
}

async function assertPublicHttpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Provider URL is not allowed");
  const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
  if (
    !addresses.length ||
    addresses.some((item) => isPrivateAddress(item.address))
  )
    throw new Error("Provider host is not allowed");
  return url;
}

interface WorkerStorage {
  getObjectBytes(input: {
    objectKey: string;
    maxBytes: number;
  }): Promise<Uint8Array>;
  putObject(input: {
    objectKey: string;
    body: Buffer;
    mimeType: string;
  }): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}

interface ClaimedTask {
  id: string;
  workspace_id: string;
  project_id: string;
  user_id: string;
  model_public_name: string;
  upstream_model_id: string;
  resolution: "1K" | "2K" | "4K";
  price: number;
  operation_type: "generate" | "edit";
  request_envelope: SecretEnvelope;
  provider_envelope: SecretEnvelope;
  protocol: "openai-compatible" | "dashscope";
  base_url: string;
}

function endpoint(baseUrl: string, operation: "generate" | "edit") {
  const url = new URL(baseUrl);
  const suffix = operation === "edit" ? "/images/edits" : "/images/generations";
  url.pathname = `${url.pathname.replace(/\/$/, "")}${suffix}`.replace(
    "/v1/v1/",
    "/v1/",
  );
  if (!url.pathname.includes("/v1/")) {
    url.pathname = `/v1${url.pathname.startsWith("/") ? "" : "/"}${url.pathname}`;
  }
  return url.toString();
}

const SIZES: Record<string, Record<"1K" | "2K" | "4K", string>> = {
  "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
  "3:2": { "1K": "1536x1024", "2K": "2048x1360", "4K": "3520x2336" },
  "2:3": { "1K": "1024x1536", "2K": "1360x2048", "4K": "2336x3520" },
  "4:3": { "1K": "1024x768", "2K": "2048x1536", "4K": "3312x2480" },
  "3:4": { "1K": "768x1024", "2K": "1536x2048", "4K": "2480x3312" },
  "16:9": { "1K": "1536x864", "2K": "2048x1152", "4K": "3840x2160" },
  "9:16": { "1K": "864x1536", "2K": "1152x2048", "4K": "2160x3840" },
};

function imageMime(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  throw new Error("Provider returned an unsupported image format");
}

function extension(mimeType: string) {
  return mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/webp"
      ? "webp"
      : "png";
}

async function responseBytes(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_OUTPUT_BYTES)
    throw new Error("Provider image exceeds maximum output size");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAX_OUTPUT_BYTES)
    throw new Error("Provider image size is invalid");
  return bytes;
}

async function downloadProviderImage(value: string) {
  const url = await assertPublicHttpsUrl(value);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("Provider image download failed");
  return responseBytes(response);
}

async function parseProviderResult(response: Response) {
  if (!response.ok)
    throw new Error(`Provider request failed with HTTP ${response.status}`);
  const payload = (await response.json()) as any;
  const item =
    payload?.data?.[0] ?? payload?.output?.results?.[0] ?? payload?.result;
  const base64 = item?.b64_json ?? item?.base64 ?? item?.image_base64;
  if (typeof base64 === "string" && base64.length > 0) {
    const bytes = Buffer.from(
      base64.replace(/^data:image\/[^;]+;base64,/, ""),
      "base64",
    );
    if (bytes.length < 1 || bytes.length > MAX_OUTPUT_BYTES)
      throw new Error("Provider image size is invalid");
    return bytes;
  }
  const url = item?.url ?? item?.image_url ?? payload?.url;
  if (typeof url === "string") return downloadProviderImage(url);
  throw new Error("Provider response did not contain an image");
}

async function loadInputs(
  pool: DbPool,
  storage: WorkerStorage,
  task: ClaimedTask,
  request: CreateOfficialImageTaskRequest,
) {
  const ids = [
    ...new Set(
      [
        ...(request.inputAssetIds ?? []),
        request.editAssetId,
        request.maskAssetId,
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  if (ids.length === 0)
    return new Map<string, { bytes: Buffer; mimeType: string }>();
  const rows = await pool.query<{
    id: string;
    object_key: string;
    mime_type: string;
  }>(
    `
    SELECT id::text, object_key, mime_type FROM assets
    WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='completed' AND deleted_at IS NULL
  `,
    [task.workspace_id, ids],
  );
  if (rows.rowCount !== ids.length)
    throw new Error("Official task input assets are no longer available");
  const output = new Map<string, { bytes: Buffer; mimeType: string }>();
  for (const row of rows.rows) {
    output.set(row.id, {
      bytes: Buffer.from(
        await storage.getObjectBytes({
          objectKey: row.object_key,
          maxBytes: MAX_INPUT_BYTES,
        }),
      ),
      mimeType: row.mime_type,
    });
  }
  return output;
}

async function executeProvider(
  pool: DbPool,
  storage: WorkerStorage,
  keyring: SecretKeyring,
  task: ClaimedTask,
) {
  const request = openSecret<CreateOfficialImageTaskRequest>(
    task.request_envelope,
    keyring,
  );
  const { apiKey } = openSecret<{ apiKey: string }>(
    task.provider_envelope,
    keyring,
  );
  const inputs = await loadInputs(pool, storage, task, request);
  const size =
    SIZES[request.ratio]?.[request.resolution] ??
    SIZES["1:1"]![request.resolution];
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (task.operation_type === "generate" && inputs.size === 0) {
    const requestUrl = await assertPublicHttpsUrl(
      endpoint(task.base_url, "generate"),
    );
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: task.upstream_model_id,
        prompt: request.prompt,
        ...(request.negativePrompt
          ? { negative_prompt: request.negativePrompt }
          : {}),
        size,
        response_format: "b64_json",
        n: 1,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10 * 60_000),
    });
    return parseProviderResult(response);
  }
  const form = new FormData();
  form.set("model", task.upstream_model_id);
  form.set("prompt", request.prompt);
  form.set("size", size);
  form.set("response_format", "b64_json");
  const orderedIds = [
    ...(request.inputAssetIds ?? []),
    request.editAssetId,
  ].filter((value): value is string => Boolean(value));
  for (const [index, id] of orderedIds.entries()) {
    const source = inputs.get(id)!;
    form.append(
      "image",
      new Blob([source.bytes], { type: source.mimeType }),
      `input-${index}.${extension(source.mimeType)}`,
    );
  }
  if (request.maskAssetId) {
    const source = inputs.get(request.maskAssetId)!;
    form.set(
      "mask",
      new Blob([source.bytes], { type: source.mimeType }),
      `mask.${extension(source.mimeType)}`,
    );
  }
  const requestUrl = await assertPublicHttpsUrl(
    endpoint(task.base_url, "edit"),
  );
  const response = await fetch(requestUrl, {
    method: "POST",
    headers,
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(10 * 60_000),
  });
  return parseProviderResult(response);
}

async function releaseTask(pool: DbPool, taskId: string, category: string) {
  await withTransaction(pool, async (client) => {
    const found = await client.query<{
      user_id: string;
      price: number;
      billing_status: string;
    }>(
      `
      SELECT user_id,price,billing_status FROM official_generation_tasks WHERE id=$1 FOR UPDATE
    `,
      [taskId],
    );
    const task = found.rows[0];
    if (!task || task.billing_status !== "reserved") return;
    const account = await client.query<any>(
      `
      UPDATE credit_accounts SET available_balance=available_balance+$2,
        reserved_balance=reserved_balance-$2,updated_at=now() WHERE user_id=$1
      RETURNING available_balance,reserved_balance
    `,
      [task.user_id, task.price],
    );
    await client.query(
      `UPDATE official_generation_tasks SET status='failed',billing_status='released',failure_category=$2,request_envelope=NULL,completed_at=now(),updated_at=now() WHERE id=$1`,
      [taskId, category],
    );
    await client.query(
      `INSERT INTO credit_ledger_entries (user_id,entry_type,available_delta,reserved_delta,available_balance,reserved_balance,reference_type,reference_id,public_note) VALUES ($1,'generation_release',$2,$3,$4,$5,'official_task',$6,'官方生成失败退回') ON CONFLICT DO NOTHING`,
      [
        task.user_id,
        task.price,
        -task.price,
        account.rows[0].available_balance,
        account.rows[0].reserved_balance,
        taskId,
      ],
    );
  });
}

async function claim(pool: DbPool) {
  return withTransaction(pool, async (client) => {
    const result = await client.query<ClaimedTask>(`
      SELECT t.id::text,t.workspace_id::text,t.project_id::text,t.user_id,
             t.model_public_name,t.upstream_model_id,t.resolution,t.price,
             t.operation_type,t.request_envelope,p.credential_envelope AS provider_envelope,
             p.protocol,p.base_url
      FROM official_generation_tasks t
      JOIN official_provider_revisions p ON p.id=t.provider_revision_id
      WHERE t.status='queued' ORDER BY t.created_at,t.id
      LIMIT 1 FOR UPDATE OF t SKIP LOCKED
    `);
    const row = result.rows[0];
    if (!row) return null;
    await client.query(
      `UPDATE official_generation_tasks SET status='running',claimed_at=now(),started_at=now(),updated_at=now() WHERE id=$1`,
      [row.id],
    );
    return row;
  });
}

async function persistSuccess(
  pool: DbPool,
  storage: WorkerStorage,
  task: ClaimedTask,
  bytes: Buffer,
) {
  const mimeType = imageMime(bytes);
  const assetId = crypto.randomUUID();
  const objectKey = `workspaces/${task.workspace_id}/projects/${task.project_id}/generated/${new Date().toISOString().slice(0, 10)}/${assetId}.${extension(mimeType)}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await withTransaction(pool, async (client) => {
    await lockWorkspaceStorageQuota(client, task.workspace_id);
    assertWorkspaceStorageCapacity(
      await readWorkspaceStorageUsage(client, task.workspace_id),
      bytes.length,
    );
    await client.query(
      `INSERT INTO assets (id,workspace_id,origin_project_id,created_by_user_id,object_key,original_file_name,mime_type,byte_size,sha256,asset_kind,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'generated','pending')`,
      [
        assetId,
        task.workspace_id,
        task.project_id,
        task.user_id,
        objectKey,
        `official-${task.id}.${extension(mimeType)}`,
        mimeType,
        bytes.length,
        sha256,
      ],
    );
  });
  try {
    await storage.putObject({ objectKey, body: bytes, mimeType });
    await withTransaction(pool, async (client) => {
      const locked = await client.query<any>(
        `SELECT billing_status FROM official_generation_tasks WHERE id=$1 FOR UPDATE`,
        [task.id],
      );
      if (locked.rows[0]?.billing_status !== "reserved")
        throw new Error("Official task was already settled");
      await client.query(
        `UPDATE assets SET status='completed',updated_at=now() WHERE id=$1`,
        [assetId],
      );
      const account = await client.query<any>(
        `UPDATE credit_accounts SET reserved_balance=reserved_balance-$2,updated_at=now() WHERE user_id=$1 RETURNING available_balance,reserved_balance`,
        [task.user_id, task.price],
      );
      await client.query(
        `UPDATE official_generation_tasks SET status='succeeded',billing_status='captured',request_envelope=NULL,result_asset_id=$2,result_protected_until=now()+interval '30 days',completed_at=now(),updated_at=now() WHERE id=$1`,
        [task.id, assetId],
      );
      await client.query(
        `INSERT INTO credit_ledger_entries (user_id,entry_type,available_delta,reserved_delta,available_balance,reserved_balance,reference_type,reference_id,public_note) VALUES ($1,'generation_capture',0,$2,$3,$4,'official_task',$5,'官方生成扣除')`,
        [
          task.user_id,
          -task.price,
          account.rows[0].available_balance,
          account.rows[0].reserved_balance,
          task.id,
        ],
      );
    });
  } catch (error) {
    await storage.deleteObject(objectKey).catch(() => undefined);
    await pool
      .query(
        `UPDATE assets SET status='failed',deleted_at=now(),quota_released_at=now(),updated_at=now() WHERE id=$1`,
        [assetId],
      )
      .catch(() => undefined);
    throw error;
  }
}

export function createOfficialGenerationWorker(options: {
  pool: DbPool;
  storage: WorkerStorage;
  keyring: SecretKeyring;
  intervalMs?: number;
}) {
  let timer: NodeJS.Timeout | null = null;
  let active = false;
  async function releaseQueuedWhenDisabled() {
    const enabled = await options.pool.query<{ enabled: boolean }>(`
      SELECT COALESCE((config_json #>> '{features,officialGenerationEnabled}')::boolean,false) AS enabled
      FROM site_config_publications WHERE singleton_id=1
    `);
    if (enabled.rows[0]?.enabled === true) return true;
    const queued = await options.pool.query<{ id: string }>(`
      SELECT id::text FROM official_generation_tasks WHERE status='queued' ORDER BY created_at,id LIMIT 100
    `);
    for (const row of queued.rows)
      await releaseTask(options.pool, row.id, "configuration");
    return false;
  }
  async function recoverInterrupted() {
    const rows = await options.pool.query<{ id: string }>(
      `
      SELECT id::text FROM official_generation_tasks
      WHERE status='running' AND claimed_at < now()-($1::text || ' minutes')::interval
    `,
      [CLAIM_TIMEOUT_MINUTES],
    );
    for (const row of rows.rows)
      await releaseTask(options.pool, row.id, "worker_interrupted");
  }
  async function runOnce() {
    if (active) return false;
    active = true;
    try {
      if (!(await releaseQueuedWhenDisabled())) return false;
      const task = await claim(options.pool);
      if (!task) return false;
      try {
        const bytes = await executeProvider(
          options.pool,
          options.storage,
          options.keyring,
          task,
        );
        await persistSuccess(options.pool, options.storage, task, bytes);
      } catch {
        await releaseTask(options.pool, task.id, "upstream");
      }
      return true;
    } finally {
      active = false;
    }
  }
  return {
    runOnce,
    async start() {
      await recoverInterrupted();
      if (timer) return;
      timer = setInterval(() => void runOnce(), options.intervalMs ?? 1_000);
      timer.unref();
      void runOnce();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
