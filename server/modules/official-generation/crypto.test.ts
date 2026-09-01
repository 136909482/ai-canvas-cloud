import assert from "node:assert/strict";
import test from "node:test";
import {
  createOfficialGenerationKeyring,
  openSecret,
  sealSecret,
} from "./crypto.ts";

test("official generation secrets use authenticated versioned encryption", () => {
  const keyring = createOfficialGenerationKeyring({
    serializedKeys: JSON.stringify({
      2: Buffer.alloc(32, 7).toString("base64"),
    }),
    activeVersion: 2,
  });
  const envelope = sealSecret({ apiKey: "private-key" }, keyring);
  assert.equal(envelope.keyVersion, 2);
  assert.deepEqual(openSecret(envelope, keyring), { apiKey: "private-key" });
  assert.throws(() =>
    openSecret(
      { ...envelope, ciphertext: Buffer.from("tampered").toString("base64") },
      keyring,
    ),
  );
});

test("official generation keyring rejects invalid active key material", () => {
  assert.throws(
    () =>
      createOfficialGenerationKeyring({
        serializedKeys: JSON.stringify({ 1: "not-a-32-byte-key" }),
        activeVersion: 1,
      }),
    /invalid key/,
  );
});
