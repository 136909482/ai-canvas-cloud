import type { GenerateTask } from "@/types";
import { useAuthStore } from "@/features/auth/useAuthStore";
import {
  isLocalVaultSupported,
  loadRememberedLocalVaultKey,
} from "@/features/settings/localVault";

export const LOCAL_TASK_DETAIL_SCHEMA_VERSION = 1;
export const LOCAL_TASK_DETAIL_CIPHER_VERSION = 1;

const DATABASE_NAME = "ai-canvas-cloud-local-vault";
const DATABASE_VERSION = 5;
const TASK_DETAIL_STORE = "taskDetails";
const AAD_NAMESPACE = "ai-canvas-cloud:local-task-detail";

export type LocalTaskDetailStatus = "succeeded" | "failed" | "canceled";

export interface LocalTaskDetail {
  schemaVersion: typeof LOCAL_TASK_DETAIL_SCHEMA_VERSION;
  userId: string;
  clientTaskId: string;
  title: string;
  kind: "image" | "video";
  status: LocalTaskDetailStatus;
  prompt: string;
  negativePrompt: string;
  model: string;
  apiProfileId: string | null;
  apiProfileName: string | null;
  provider: string | null;
  ratio: string;
  resolution: string;
  operationType: string;
  referenceImageCount: number;
  quality?: string | null;
  videoMode?: string | null;
  videoDuration?: string | null;
  errorMsg: string;
  resultAssetIds: string[];
  displayId: string;
  startedAt: number;
  finishedAt: number | null;
  updatedAt: number;
}

interface EncryptedLocalTaskDetailRecord {
  id: string;
  ownerId: string;
  cipherVersion: typeof LOCAL_TASK_DETAIL_CIPHER_VERSION;
  schemaVersion: number;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  updatedAt: number;
}

function getCrypto() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("当前浏览器不支持 WebCrypto，无法加密任务详情");
  }
  return cryptoApi;
}

function getOrigin() {
  if (typeof window === "undefined") return "https://test.invalid";
  return window.location.origin;
}

function getOwnerId(userId: string) {
  const normalized = userId.trim();
  if (!normalized) throw new Error("本地任务详情缺少登录用户 ID");
  return `user:${normalized}`;
}

function getRecordId(userId: string, clientTaskId: string) {
  return `${getOwnerId(userId)}:task:${clientTaskId.trim()}`;
}

function createAdditionalData(
  origin: string,
  userId: string,
  clientTaskId: string,
  schemaVersion: number,
) {
  return new TextEncoder().encode(
    [
      AAD_NAMESPACE,
      `cipher=${LOCAL_TASK_DETAIL_CIPHER_VERSION}`,
      `schema=${schemaVersion}`,
      `origin=${origin}`,
      `user=${userId}`,
      `task=${clientTaskId}`,
    ].join("\n"),
  );
}

export function buildLocalTaskDetail(
  task: GenerateTask,
  terminal:
    | { status: "succeeded"; resultCount: number }
    | { status: "failed"; failureCategory: string }
    | { status: "canceled" },
  userId: string,
): LocalTaskDetail {
  const resultAsset =
    task.kind === "video" ? task.resultVideoAsset : task.resultImageAsset;
  return {
    schemaVersion: LOCAL_TASK_DETAIL_SCHEMA_VERSION,
    userId,
    clientTaskId: task.id,
    title: `${task.kind === "video" ? "视频生成" : "图像生成"} #${task.displayId}`,
    kind: task.kind,
    status: terminal.status,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt ?? "",
    model: task.model,
    apiProfileId: task.apiProfileId ?? null,
    apiProfileName: task.apiProfileName ?? null,
    provider: task.provider ?? null,
    ratio: task.ratio ?? "1:1",
    resolution: task.resolution ?? "1K",
    operationType: task.operationType,
    referenceImageCount: task.referenceImages.length,
    quality: task.quality ?? null,
    videoMode: task.videoMode ?? null,
    videoDuration: task.videoDuration ?? null,
    errorMsg: task.errorMsg ?? "",
    resultAssetIds: resultAsset?.assetId ? [resultAsset.assetId] : [],
    displayId: task.displayId,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    updatedAt: Date.now(),
  };
}

function isLocalTaskDetail(value: unknown): value is LocalTaskDetail {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const detail = value as Partial<LocalTaskDetail>;
  return (
    detail.schemaVersion === LOCAL_TASK_DETAIL_SCHEMA_VERSION &&
    typeof detail.userId === "string" &&
    typeof detail.clientTaskId === "string" &&
    typeof detail.title === "string" &&
    (detail.kind === "image" || detail.kind === "video") &&
    (detail.status === "succeeded" ||
      detail.status === "failed" ||
      detail.status === "canceled") &&
    typeof detail.prompt === "string" &&
    typeof detail.model === "string" &&
    typeof detail.startedAt === "number" &&
    typeof detail.updatedAt === "number"
  );
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB 请求失败")),
      { once: true },
    );
  });
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB 事务已中止")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB 事务失败")),
      { once: true },
    );
  });
}

function openTaskDetailDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("当前浏览器不支持 IndexedDB，无法保存任务详情"),
    );
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(TASK_DETAIL_STORE)) {
        const store = database.createObjectStore(TASK_DETAIL_STORE, {
          keyPath: "id",
        });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("无法打开本地任务详情库")),
      { once: true },
    );
  });
}

export async function encryptLocalTaskDetail(
  detail: LocalTaskDetail,
  key: CryptoKey,
  origin = getOrigin(),
): Promise<EncryptedLocalTaskDetailRecord> {
  const cryptoApi = getCrypto();
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(detail));
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: createAdditionalData(
        origin,
        detail.userId,
        detail.clientTaskId,
        LOCAL_TASK_DETAIL_SCHEMA_VERSION,
      ),
      tagLength: 128,
    },
    key,
    plaintext,
  );
  return {
    id: getRecordId(detail.userId, detail.clientTaskId),
    ownerId: getOwnerId(detail.userId),
    cipherVersion: LOCAL_TASK_DETAIL_CIPHER_VERSION,
    schemaVersion: LOCAL_TASK_DETAIL_SCHEMA_VERSION,
    iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
    ciphertext,
    updatedAt: detail.updatedAt,
  };
}

export async function decryptLocalTaskDetail(
  record: EncryptedLocalTaskDetailRecord,
  key: CryptoKey,
  userId: string,
  clientTaskId: string,
  origin = getOrigin(),
): Promise<LocalTaskDetail> {
  if (
    record.cipherVersion !== LOCAL_TASK_DETAIL_CIPHER_VERSION ||
    record.schemaVersion !== LOCAL_TASK_DETAIL_SCHEMA_VERSION
  ) {
    throw new Error("本地任务详情版本不受支持");
  }
  const plaintext = await getCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: record.iv,
      additionalData: createAdditionalData(
        origin,
        userId,
        clientTaskId,
        record.schemaVersion,
      ),
      tagLength: 128,
    },
    key,
    record.ciphertext,
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  if (
    !isLocalTaskDetail(parsed) ||
    parsed.userId !== userId ||
    parsed.clientTaskId !== clientTaskId
  ) {
    throw new Error("本地任务详情内容无效");
  }
  return parsed;
}

export async function saveLocalTaskDetail(
  detail: LocalTaskDetail,
  key: CryptoKey,
) {
  const database = await openTaskDetailDatabase();
  try {
    const record = await encryptLocalTaskDetail(detail, key);
    const transaction = database.transaction(TASK_DETAIL_STORE, "readwrite");
    transaction.objectStore(TASK_DETAIL_STORE).put(record);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function loadLocalTaskDetail(
  userId: string,
  clientTaskId: string,
  key: CryptoKey,
): Promise<LocalTaskDetail | null> {
  const database = await openTaskDetailDatabase();
  try {
    const transaction = database.transaction(TASK_DETAIL_STORE, "readonly");
    const record = (await requestToPromise(
      transaction
        .objectStore(TASK_DETAIL_STORE)
        .get(getRecordId(userId, clientTaskId)),
    )) as EncryptedLocalTaskDetailRecord | undefined;
    await transactionToPromise(transaction);
    if (!record) return null;
    return decryptLocalTaskDetail(record, key, userId, clientTaskId);
  } finally {
    database.close();
  }
}

// 任务终态时持久化敏感详情到本地加密存储；未启用本地 Vault（无密钥）时静默跳过。
export async function persistLocalTaskDetail(
  task: GenerateTask,
  terminal: Parameters<typeof buildLocalTaskDetail>[1],
) {
  if (!isLocalVaultSupported()) {
    return;
  }
  const session = useAuthStore.getState().session;
  if (!session) {
    return;
  }
  const key = await loadRememberedLocalVaultKey(session.user.id);
  if (!key) {
    return;
  }
  await saveLocalTaskDetail(
    buildLocalTaskDetail(task, terminal, session.user.id),
    key,
  );
}
