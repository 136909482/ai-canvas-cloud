import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface ObjectStorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ObjectStorageCredentialEnvelope {
  algorithm: "aes-256-gcm";
  keyVersion: number;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export interface ObjectStorageCredentialKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

function parseVersion(value: string | number | undefined) {
  const version = Number(value ?? 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION must be positive",
    );
  }
  return version;
}

export function createObjectStorageCredentialKeyring(options: {
  serializedKeys?: string;
  activeVersion?: string | number;
  developmentSecret?: string;
}): ObjectStorageCredentialKeyring {
  const activeVersion = parseVersion(options.activeVersion);
  const keys = new Map<number, Buffer>();
  if (options.serializedKeys?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.serializedKeys);
    } catch {
      throw new Error("OBJECT_STORAGE_CREDENTIAL_KEYS must be valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("OBJECT_STORAGE_CREDENTIAL_KEYS must be a version map");
    }
    for (const [rawVersion, rawKey] of Object.entries(parsed)) {
      const version = parseVersion(rawVersion);
      if (typeof rawKey !== "string") {
        throw new Error(
          "Object storage credential keys must be base64 strings",
        );
      }
      const key = Buffer.from(rawKey, "base64");
      if (key.length !== 32) {
        throw new Error(
          "Object storage credential keys must decode to 32 bytes",
        );
      }
      keys.set(version, key);
    }
  } else if (options.developmentSecret) {
    keys.set(
      activeVersion,
      createHash("sha256")
        .update("ai-canvas-cloud-development-object-storage\0")
        .update(options.developmentSecret)
        .digest(),
    );
  }
  if (!keys.has(activeVersion)) {
    throw new Error("Active object storage credential key is missing");
  }
  return { activeVersion, keys };
}

function aad(revisionId: string) {
  return Buffer.from(`object-storage-config:${revisionId}:credentials`, "utf8");
}

export function encryptObjectStorageCredentials(
  credentials: ObjectStorageCredentials,
  revisionId: string,
  keyring: ObjectStorageCredentialKeyring,
): ObjectStorageCredentialEnvelope {
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key)
    throw new Error("Active object storage credential key is unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(revisionId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
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

export function decryptObjectStorageCredentials(
  envelope: ObjectStorageCredentialEnvelope,
  revisionId: string,
  keyring: ObjectStorageCredentialKeyring,
): ObjectStorageCredentials {
  if (envelope.algorithm !== "aes-256-gcm") {
    throw new Error("Object storage credential algorithm is unsupported");
  }
  const key = keyring.keys.get(envelope.keyVersion);
  if (!key)
    throw new Error("Object storage credential key version is unavailable");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(aad(revisionId));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const parsed: unknown = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as ObjectStorageCredentials).accessKeyId !== "string" ||
    typeof (parsed as ObjectStorageCredentials).secretAccessKey !== "string"
  ) {
    throw new Error("Object storage credentials are invalid");
  }
  return parsed as ObjectStorageCredentials;
}
