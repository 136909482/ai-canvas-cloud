import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import {
  LOCAL_TASK_CACHE_SCHEMA_VERSION,
  LOCAL_VAULT_SCHEMA_VERSION,
  createLocalVaultKey,
  decryptLocalTaskQueueDocument,
  decryptPendingTaskResult,
  decryptLocalVaultDocument,
  encryptLocalTaskQueueDocument,
  encryptPendingTaskResult,
  encryptLocalVaultDocument,
  loadRememberedPendingTaskResult,
  saveRememberedPendingTaskResult,
  type LocalTaskQueueDocument,
  type LocalVaultDocument,
} from "./localVault.ts";

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), {
      once: true,
    });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
  });
}

async function encryptLegacyRecord(
  plaintext: unknown,
  key: CryptoKey,
  aad: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(aad),
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(JSON.stringify(plaintext)),
  );
  return { iv: iv.buffer, ciphertext };
}

test("v3 Vault encrypts provider credentials separately from profiles", async () => {
  const document: LocalVaultDocument = {
    schemaVersion: LOCAL_VAULT_SCHEMA_VERSION,
    userId: "user-a",
    defaultModelEntryId: "entry-a",
    lastUsedModelEntryIds: { image: "entry-a" },
    providerProfiles: [
      {
        id: "provider-a",
        name: "Provider",
        protocol: "openai-compatible",
        authMode: "bearer",
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    customImageProviderManifests: [],
    providerApiKeys: { "provider-a": "secret-key" },
    modelEntries: [
      {
        id: "entry-a",
        providerProfileId: "provider-a",
        modelId: "model-a",
        displayName: "Model A",
        category: "image",
        source: "manual",
        status: "available",
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    localModelBindings: {
      "local:11111111-1111-4111-8111-111111111111": "entry-a",
    },
    updatedAt: 2,
  };
  const key = await createLocalVaultKey();
  const encrypted = await encryptLocalVaultDocument(
    document,
    key,
    "https://cloud.example",
  );
  assert.equal(
    new TextDecoder().decode(encrypted.ciphertext).includes("secret-key"),
    false,
  );
  const decrypted = await decryptLocalVaultDocument(
    encrypted,
    key,
    "user-a",
    "https://cloud.example",
  );
  assert.equal(decrypted.providerApiKeys["provider-a"], "secret-key");
  assert.deepEqual(decrypted.lastUsedModelEntryIds, { image: "entry-a" });
  assert.equal(LOCAL_TASK_CACHE_SCHEMA_VERSION, 4);
});

test("encrypted current task cache records round-trip", async () => {
  const key = await createLocalVaultKey();
  const origin = "https://cloud.example";
  const userId = "user-a";
  const projectId = "project-a";
  const document: LocalTaskQueueDocument = {
    schemaVersion: LOCAL_TASK_CACHE_SCHEMA_VERSION,
    userId,
    projectId,
    taskQueue: { tasks: [] },
    updatedAt: 42,
  };
  const encrypted = await encryptLocalTaskQueueDocument(document, key, origin);
  const decrypted = await decryptLocalTaskQueueDocument(
    encrypted,
    key,
    userId,
    projectId,
    origin,
  );

  assert.deepEqual(decrypted, document);
});

test("v2 Vault AAD decrypts and migrates provider protocol fields", async () => {
  const key = await createLocalVaultKey();
  const legacy = {
    schemaVersion: 2,
    userId: "legacy-user",
    defaultModelEntryId: "",
    modelEntries: [],
    providerProfiles: [
      {
        id: "dashscope-profile",
        name: "DashScope",
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
        enabled: true,
        imageRequestMode: "async",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    providerApiKeys: { "dashscope-profile": "legacy-key" },
    localModelBindings: {},
    updatedAt: 2,
  };
  const encrypted = await encryptLegacyRecord(
    legacy,
    key,
    [
      "ai-canvas-cloud:local-vault",
      "cipher=1",
      "schema=2",
      "origin=https://cloud.example",
      "user=legacy-user",
    ].join("\n"),
  );
  const migrated = await decryptLocalVaultDocument(
    {
      id: "user:legacy-user",
      cipherVersion: 1,
      schemaVersion: 2,
      ...encrypted,
      updatedAt: 2,
    },
    key,
    "legacy-user",
    "https://cloud.example",
  );

  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.customImageProviderManifests, []);
  assert.equal(migrated.providerProfiles[0]?.protocol, "dashscope");
  assert.equal(migrated.providerProfiles[0]?.authMode, "bearer");
  assert.equal(migrated.providerProfiles[0]?.imageRequestMode, "sync");
  assert.equal(migrated.providerApiKeys["dashscope-profile"], "legacy-key");
});

test("v3 task cache AAD decrypts and migrates to v4", async () => {
  const key = await createLocalVaultKey();
  const legacy = {
    schemaVersion: 3,
    userId: "legacy-user",
    projectId: "project-a",
    taskQueue: { tasks: [] },
    updatedAt: 3,
  };
  const encrypted = await encryptLegacyRecord(
    legacy,
    key,
    [
      "ai-canvas-cloud:local-task-cache",
      "cipher=1",
      "schema=3",
      "origin=https://cloud.example",
      "user=legacy-user",
      "project=project-a",
    ].join("\n"),
  );
  const migrated = await decryptLocalTaskQueueDocument(
    {
      id: "user:legacy-user:project:project-a",
      ownerId: "user:legacy-user",
      cipherVersion: 1,
      schemaVersion: 3,
      ...encrypted,
      updatedAt: 3,
    },
    key,
    "legacy-user",
    "project-a",
    "https://cloud.example",
  );

  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.taskQueue.tasks, []);
});

test("pending image results are encrypted and isolated by user, project, and task", async () => {
  const key = await createLocalVaultKey();
  const sourceBlob = new Blob(["private image bytes"], { type: "image/png" });
  const encrypted = await encryptPendingTaskResult(
    {
      userId: "user-a",
      projectId: "project-a",
      taskId: "task-a",
      blob: sourceBlob,
    },
    key,
    "https://cloud.example",
  );

  assert.equal(
    new TextDecoder()
      .decode(encrypted.ciphertext)
      .includes("private image bytes"),
    false,
  );
  const decrypted = await decryptPendingTaskResult(
    encrypted,
    key,
    "user-a",
    "project-a",
    "task-a",
    "https://cloud.example",
  );
  assert.equal(decrypted.type, "image/png");
  assert.equal(await decrypted.text(), "private image bytes");

  await assert.rejects(
    decryptPendingTaskResult(
      encrypted,
      key,
      "user-b",
      "project-a",
      "task-a",
      "https://cloud.example",
    ),
    /归属无效/,
  );
});

test("v4 database upgrade repairs a v3 Vault missing the task results store", async () => {
  const databaseFactory = new IDBFactory();
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: databaseFactory,
  });

  const legacyRequest = databaseFactory.open("ai-canvas-cloud-local-vault", 3);
  legacyRequest.addEventListener("upgradeneeded", () => {
    const database = legacyRequest.result;
    database.createObjectStore("vaults", { keyPath: "id" });
    database.createObjectStore("keys");
    const taskStore = database.createObjectStore("taskQueues", {
      keyPath: "id",
    });
    taskStore.createIndex("ownerId", "ownerId", { unique: false });
  });
  const legacyDatabase = await requestResult(legacyRequest);
  const key = await createLocalVaultKey();
  const keyTransaction = legacyDatabase.transaction("keys", "readwrite");
  keyTransaction.objectStore("keys").put(key, "user:user-a");
  await transactionDone(keyTransaction);
  legacyDatabase.close();

  const sourceBlob = new Blob(["recoverable image"], { type: "image/png" });
  await saveRememberedPendingTaskResult(
    "user-a",
    "project-a",
    "task-a",
    sourceBlob,
  );

  const restoredBlob = await loadRememberedPendingTaskResult(
    "user-a",
    "project-a",
    "task-a",
  );
  assert.ok(restoredBlob);
  assert.equal(await restoredBlob.text(), "recoverable image");

  const upgradedDatabase = await requestResult(
    databaseFactory.open("ai-canvas-cloud-local-vault"),
  );
  assert.equal(upgradedDatabase.version, 4);
  assert.equal(upgradedDatabase.objectStoreNames.contains("taskResults"), true);
  upgradedDatabase.close();
});
