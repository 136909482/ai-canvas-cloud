import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_TASK_CACHE_SCHEMA_VERSION,
  LOCAL_VAULT_SCHEMA_VERSION,
  createLocalVaultKey,
  decryptLocalVaultDocument,
  encryptLocalVaultDocument,
  type LocalVaultDocument,
} from "./localVault.ts";

test("v2 Vault encrypts provider credentials separately from profiles", async () => {
  const document: LocalVaultDocument = {
    schemaVersion: LOCAL_VAULT_SCHEMA_VERSION,
    userId: "user-a",
    defaultModelEntryId: "entry-a",
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
  assert.equal(LOCAL_TASK_CACHE_SCHEMA_VERSION, 2);
});
