import assert from "node:assert/strict";
import test from "node:test";
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
  type LocalTaskQueueDocument,
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
