import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_TASK_CACHE_SCHEMA_VERSION,
  LOCAL_VAULT_SCHEMA_VERSION,
  createLocalVaultKey,
  decryptLocalTaskQueueDocument,
  decryptPendingTaskResult,
  decryptLocalVaultDocument,
  encryptPendingTaskResult,
  encryptLocalVaultDocument,
  migrateLocalTaskQueueDocument,
  type LocalVaultDocument,
} from "./localVault.ts";

test("v2 Vault encrypts provider credentials separately from profiles", async () => {
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
        baseUrl: "https://example.com/v1",
        enabled: true,
        imageRequestMode: "sync",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
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
  assert.equal(LOCAL_TASK_CACHE_SCHEMA_VERSION, 3);
});

test("v2 task cache documents migrate to v3 without changing task data", () => {
  const taskQueue = { tasks: [] };
  const migrated = migrateLocalTaskQueueDocument({
    schemaVersion: 2,
    userId: "user-a",
    projectId: "project-a",
    taskQueue,
    updatedAt: 42,
  });

  assert.deepEqual(migrated, {
    schemaVersion: 3,
    userId: "user-a",
    projectId: "project-a",
    taskQueue,
    updatedAt: 42,
  });
});

test("encrypted v2 task cache records decrypt and migrate to v3", async () => {
  const key = await createLocalVaultKey();
  const origin = "https://cloud.example";
  const userId = "user-a";
  const projectId = "project-a";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const legacyDocument = {
    schemaVersion: 2,
    userId,
    projectId,
    taskQueue: { tasks: [] },
    updatedAt: 42,
  };
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(
        [
          "ai-canvas-cloud:local-task-cache",
          "cipher=1",
          "schema=2",
          `origin=${origin}`,
          `user=${userId}`,
          `project=${projectId}`,
        ].join("\n"),
      ),
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(JSON.stringify(legacyDocument)),
  );

  const migrated = await decryptLocalTaskQueueDocument(
    {
      id: `user:${userId}:project:${projectId}`,
      ownerId: `user:${userId}`,
      cipherVersion: 1,
      schemaVersion: 2,
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
      ciphertext,
      updatedAt: 42,
    },
    key,
    userId,
    projectId,
    origin,
  );

  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.taskQueue, { tasks: [] });
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
