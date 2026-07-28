import assert from "node:assert/strict";
import test from "node:test";
import {
  createObjectStorageCredentialKeyring,
  decryptObjectStorageCredentials,
  encryptObjectStorageCredentials,
} from "./objectStorageCredentials.ts";

const keyring = createObjectStorageCredentialKeyring({
  serializedKeys: JSON.stringify({ 1: Buffer.alloc(32, 7).toString("base64") }),
  activeVersion: 1,
});

test("object storage credentials round trip with revision-bound AAD", () => {
  const encrypted = encryptObjectStorageCredentials(
    { accessKeyId: "access", secretAccessKey: "secret" },
    "revision-1",
    keyring,
  );
  assert.deepEqual(
    decryptObjectStorageCredentials(encrypted, "revision-1", keyring),
    { accessKeyId: "access", secretAccessKey: "secret" },
  );
  assert.throws(() =>
    decryptObjectStorageCredentials(encrypted, "revision-2", keyring),
  );
});
