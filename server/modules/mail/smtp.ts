import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";
import type { SmtpSecurityMode } from "@ai-canvas-cloud/contracts";
import nodemailer from "nodemailer";

export type SmtpFailureCategory =
  | "host_not_allowed"
  | "dns"
  | "connection"
  | "tls"
  | "authentication"
  | "sender_rejected"
  | "recipient_rejected";

export interface SmtpCredentialEnvelope {
  algorithm: "aes-256-gcm";
  keyVersion: number;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export interface SmtpCredentialKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export interface SmtpRuntimeConfig {
  revisionId: string;
  host: string;
  port: number;
  securityMode: SmtpSecurityMode;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  source: "managed" | "environment";
}

export interface SmtpMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function legacySmtpRuntimeConfig(options: {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  username: string;
  password: string;
}): SmtpRuntimeConfig {
  const formatted = /^(.*?)\s*<([^<>]+)>$/.exec(options.from.trim());
  return {
    revisionId: "environment",
    host: options.host,
    port: options.port,
    securityMode: options.secure ? "implicit_tls" : "starttls",
    username: options.username,
    password: options.password,
    fromEmail: (formatted?.[2] ?? options.from).trim().toLowerCase(),
    fromName: formatted?.[1]?.trim() || "AI Canvas",
    source: "environment",
  };
}

export class SmtpTransportError extends Error {
  readonly category: SmtpFailureCategory;

  constructor(category: SmtpFailureCategory) {
    super(`SMTP ${category.replaceAll("_", " ")}`);
    this.name = "SmtpTransportError";
    this.category = category;
  }
}

function parseVersion(value: string | number | undefined) {
  const version = Number(value ?? 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("SMTP_CREDENTIAL_ACTIVE_KEY_VERSION must be positive");
  }
  return version;
}

export function createSmtpCredentialKeyring(options: {
  serializedKeys?: string;
  activeVersion?: string | number;
  developmentSecret?: string;
}): SmtpCredentialKeyring {
  const activeVersion = parseVersion(options.activeVersion);
  const keys = new Map<number, Buffer>();
  if (options.serializedKeys?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.serializedKeys);
    } catch {
      throw new Error("SMTP_CREDENTIAL_KEYS must be valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("SMTP_CREDENTIAL_KEYS must be a version map");
    }
    for (const [rawVersion, rawKey] of Object.entries(parsed)) {
      const version = parseVersion(rawVersion);
      if (typeof rawKey !== "string") {
        throw new Error("SMTP credential keys must be base64 strings");
      }
      const key = Buffer.from(rawKey, "base64");
      if (key.length !== 32) {
        throw new Error("SMTP credential keys must decode to 32 bytes");
      }
      keys.set(version, key);
    }
  } else if (options.developmentSecret) {
    keys.set(
      activeVersion,
      createHash("sha256")
        .update("ai-canvas-cloud-development-smtp\0")
        .update(options.developmentSecret)
        .digest(),
    );
  }
  if (!keys.has(activeVersion)) {
    throw new Error("Active SMTP credential key is missing");
  }
  return { activeVersion, keys };
}

function credentialAad(revisionId: string) {
  return Buffer.from(`smtp-config:${revisionId}:password`, "utf8");
}

export function encryptSmtpPassword(
  password: string,
  revisionId: string,
  keyring: SmtpCredentialKeyring,
): SmtpCredentialEnvelope {
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key) throw new Error("Active SMTP credential key is unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(credentialAad(revisionId));
  const ciphertext = Buffer.concat([
    cipher.update(password, "utf8"),
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

export function decryptSmtpPassword(
  envelope: SmtpCredentialEnvelope,
  revisionId: string,
  keyring: SmtpCredentialKeyring,
) {
  if (envelope.algorithm !== "aes-256-gcm") {
    throw new Error("SMTP credential algorithm is unsupported");
  }
  const key = keyring.keys.get(envelope.keyVersion);
  if (!key) throw new Error("SMTP credential key version is unavailable");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(credentialAad(revisionId));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const BLOCKED_SMTP_TARGETS = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_SMTP_TARGETS.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_SMTP_TARGETS.addSubnet(network, prefix, "ipv6");
}

function isBlockedIp(address: string) {
  const family = isIP(address);
  if (family === 4) return BLOCKED_SMTP_TARGETS.check(address, "ipv4");
  if (family === 6) return BLOCKED_SMTP_TARGETS.check(address, "ipv6");
  return true;
}

export async function resolvePublicSmtpTarget(
  host: string,
  lookup: typeof dns.lookup = dns.lookup,
) {
  const literalFamily = isIP(host);
  const addresses = literalFamily
    ? [{ address: host, family: literalFamily }]
    : await lookup(host, { all: true, verbatim: true }).catch(() => {
        throw new SmtpTransportError("dns");
      });
  if (addresses.length === 0) throw new SmtpTransportError("dns");
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    throw new SmtpTransportError("host_not_allowed");
  }
  return addresses[0]!;
}

function mapTransportError(error: unknown): SmtpTransportError {
  if (error instanceof SmtpTransportError) return error;
  const candidate = error as {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
  };
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const command =
    typeof candidate?.command === "string" ? candidate.command : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "EAUTH" || command === "AUTH") {
    return new SmtpTransportError("authentication");
  }
  if (/CERT|TLS|SSL|VERIFY|SELF_SIGNED|EPROTO/i.test(`${code} ${message}`)) {
    return new SmtpTransportError("tls");
  }
  if (/^MAIL/i.test(command)) return new SmtpTransportError("sender_rejected");
  if (/^RCPT/i.test(command)) {
    return new SmtpTransportError("recipient_rejected");
  }
  return new SmtpTransportError("connection");
}

export function smtpTransportOptions(
  config: SmtpRuntimeConfig,
  targetAddress: string,
) {
  return {
    host: targetAddress,
    port: config.port,
    secure: config.securityMode === "implicit_tls",
    requireTLS: config.securityMode === "starttls",
    auth: { user: config.username, pass: config.password },
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2" as const,
      ...(isIP(config.host) ? {} : { servername: config.host }),
    },
  };
}

interface SmtpTransportDependencies {
  resolveTarget?: (
    host: string,
  ) => Promise<{ address: string; family: number }>;
  createTransport?: (
    options: ReturnType<typeof smtpTransportOptions>,
  ) => nodemailer.Transporter;
}

async function createTransport(
  config: SmtpRuntimeConfig,
  dependencies: SmtpTransportDependencies,
) {
  const target = await (dependencies.resolveTarget ?? resolvePublicSmtpTarget)(
    config.host,
  );
  return (dependencies.createTransport ?? nodemailer.createTransport)(
    smtpTransportOptions(config, target.address),
  );
}

export async function verifySmtpConnection(
  config: SmtpRuntimeConfig,
  dependencies: SmtpTransportDependencies = {},
) {
  let transporter: nodemailer.Transporter | undefined;
  try {
    transporter = await createTransport(config, dependencies);
    await transporter.verify();
  } catch (error) {
    throw mapTransportError(error);
  } finally {
    transporter?.close();
  }
}

export async function sendSmtpMessage(
  config: SmtpRuntimeConfig,
  message: SmtpMessage,
  dependencies: SmtpTransportDependencies = {},
) {
  let transporter: nodemailer.Transporter | undefined;
  try {
    transporter = await createTransport(config, dependencies);
    await transporter.sendMail({
      from: { name: config.fromName, address: config.fromEmail },
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  } catch (error) {
    throw mapTransportError(error);
  } finally {
    transporter?.close();
  }
}

type SmtpTransport = Pick<nodemailer.Transporter, "close" | "sendMail">;

export function createRevisionCachedSmtpSender(
  options: {
    lookup?: typeof dns.lookup;
    createTransport?: (
      transportOptions: ReturnType<typeof smtpTransportOptions>,
    ) => SmtpTransport;
  } = {},
) {
  let cached:
    | {
        revisionId: string;
        targetAddress: string;
        transport: SmtpTransport;
      }
    | undefined;
  const createTransport =
    options.createTransport ??
    ((transportOptions: ReturnType<typeof smtpTransportOptions>) =>
      nodemailer.createTransport(transportOptions));

  return {
    async send(config: SmtpRuntimeConfig, message: SmtpMessage) {
      try {
        const target = await resolvePublicSmtpTarget(
          config.host,
          options.lookup,
        );
        if (
          !cached ||
          cached.revisionId !== config.revisionId ||
          cached.targetAddress !== target.address
        ) {
          cached?.transport.close();
          cached = {
            revisionId: config.revisionId,
            targetAddress: target.address,
            transport: createTransport(
              smtpTransportOptions(config, target.address),
            ),
          };
        }
        await cached.transport.sendMail({
          from: { name: config.fromName, address: config.fromEmail },
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        });
      } catch (error) {
        cached?.transport.close();
        cached = undefined;
        throw mapTransportError(error);
      }
    },
    close() {
      cached?.transport.close();
      cached = undefined;
    },
  };
}
