import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface SecretEnvelope {
  algorithm: "aes-256-gcm";
  keyVersion: number;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export interface SecretKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export function createOfficialGenerationKeyring(options: {
  serializedKeys?: string;
  activeVersion?: number;
  developmentSecret?: string;
}): SecretKeyring {
  const activeVersion = options.activeVersion ?? 1;
  if (!Number.isInteger(activeVersion) || activeVersion < 1) {
    throw new Error(
      "OFFICIAL_GENERATION_CREDENTIAL_ACTIVE_KEY_VERSION must be positive",
    );
  }
  const keys = new Map<number, Buffer>();
  if (options.serializedKeys?.trim()) {
    const parsed = JSON.parse(options.serializedKeys) as Record<string, string>;
    for (const [version, encoded] of Object.entries(parsed)) {
      const key = Buffer.from(encoded, "base64");
      if (!/^\d+$/.test(version) || key.length !== 32) {
        throw new Error(
          "OFFICIAL_GENERATION_CREDENTIAL_KEYS contains an invalid key",
        );
      }
      keys.set(Number(version), key);
    }
  } else if (options.developmentSecret) {
    keys.set(
      activeVersion,
      createHash("sha256")
        .update("ai-canvas-cloud:official-generation")
        .update("\0")
        .update(options.developmentSecret)
        .digest(),
    );
  }
  if (!keys.has(activeVersion)) {
    throw new Error("Active official generation credential key is missing");
  }
  return { activeVersion, keys };
}

export function sealSecret(
  value: unknown,
  keyring: SecretKeyring,
): SecretEnvelope {
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key) throw new Error("Active official generation key is unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    keyVersion: keyring.activeVersion,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function openSecret<T>(
  envelope: SecretEnvelope,
  keyring: SecretKeyring,
): T {
  if (envelope.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported official generation credential envelope");
  }
  const key = keyring.keys.get(envelope.keyVersion);
  if (!key)
    throw new Error("Official generation credential key is unavailable");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
