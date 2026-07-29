import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../../db/postgres.ts";
import { createManagedS3ObjectStorage } from "./managedS3ObjectStorage.ts";
import { createObjectStorageCredentialKeyring } from "./objectStorageCredentials.ts";

test("managed object storage reports an explicit error before first configuration", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  } as unknown as DbPool;
  const storage = createManagedS3ObjectStorage(pool, {
    keyring: createObjectStorageCredentialKeyring({
      serializedKeys: JSON.stringify({
        1: Buffer.alloc(32, 7).toString("base64"),
      }),
      activeVersion: 1,
    }),
  });

  await assert.rejects(storage.checkHealth(), /not configured/);
  storage.destroy();
});
