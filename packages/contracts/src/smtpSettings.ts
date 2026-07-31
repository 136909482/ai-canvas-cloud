export type SmtpSecurityMode = "implicit_tls" | "starttls";
export type SmtpSettingsState = "unconfigured" | "active" | "disabled";
export type SmtpSettingsSource = "managed" | "none";

export interface SmtpSettingsResponse {
  state: SmtpSettingsState;
  source: SmtpSettingsSource;
  host: string | null;
  port: number | null;
  securityMode: SmtpSecurityMode | null;
  username: string | null;
  passwordConfigured: boolean;
  fromEmail: string | null;
  fromName: string | null;
  revisionId: string | null;
  updatedAt: string | null;
}

export interface SmtpSettingsInput {
  host: string;
  port: number;
  securityMode: SmtpSecurityMode;
  username: string;
  password?: string;
  fromEmail: string;
  fromName: string;
  expectedRevisionId: string | null;
}

export interface SmtpTestEmailInput extends SmtpSettingsInput {
  recipient: string;
}

export interface SmtpTestResponse {
  ok: true;
  testedAt: string;
}

export interface DisableSmtpSettingsInput {
  expectedRevisionId: string;
}

const SMTP_PORTS = new Set([25, 465, 587, 2525]);
const SECURITY_MODES = new Set<SmtpSecurityMode>(["implicit_tls", "starttls"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isIpv4Literal(value: string) {
  return (
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) &&
    value.split(".").every((part) => Number(part) <= 255)
  );
}

function ipv6SectionCount(sections: string[]) {
  let count = 0;
  for (const [index, section] of sections.entries()) {
    if (/^[0-9a-f]{1,4}$/i.test(section)) {
      count += 1;
      continue;
    }
    if (index === sections.length - 1 && isIpv4Literal(section)) {
      count += 2;
      continue;
    }
    return null;
  }
  return count;
}

function isIpLiteral(value: string) {
  if (isIpv4Literal(value)) return true;
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return false;
  const compressed = value.includes("::");
  if (compressed && value.indexOf("::") !== value.lastIndexOf("::")) {
    return false;
  }
  const [left = "", right = ""] = compressed ? value.split("::") : [value, ""];
  const leftSections = left ? left.split(":") : [];
  const rightSections = right ? right.split(":") : [];
  const leftCount = ipv6SectionCount(leftSections);
  const rightCount = ipv6SectionCount(rightSections);
  if (leftCount === null || rightCount === null) return false;
  const total = leftCount + rightCount;
  return compressed ? total < 8 : total === 8;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SMTP settings must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const supported = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!supported.has(key)) throw new Error(`${key} is not supported`);
  }
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${field} length is invalid`);
  }
  return normalized;
}

function email(value: unknown, field: string) {
  const normalized = text(value, field, 3, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

export function validateSmtpSettingsInput(value: unknown): SmtpSettingsInput {
  const input = record(value);
  exactKeys(input, [
    "host",
    "port",
    "securityMode",
    "username",
    "password",
    "fromEmail",
    "fromName",
    "expectedRevisionId",
  ]);
  const host = text(input.host, "host", 1, 253).toLowerCase();
  const ipLiteral = isIpLiteral(host);
  const looksLikeIpv4 = /^(?:\d+\.){3}\d+$/.test(host);
  if (
    (looksLikeIpv4 && !ipLiteral) ||
    (!HOST_PATTERN.test(host) && !ipLiteral)
  ) {
    throw new Error("host is invalid");
  }
  if (
    typeof input.port !== "number" ||
    !Number.isInteger(input.port) ||
    !SMTP_PORTS.has(input.port)
  ) {
    throw new Error("port is invalid");
  }
  if (
    typeof input.securityMode !== "string" ||
    !SECURITY_MODES.has(input.securityMode as SmtpSecurityMode)
  ) {
    throw new Error("securityMode is invalid");
  }
  const expectedRevisionId = input.expectedRevisionId;
  if (
    expectedRevisionId !== null &&
    (typeof expectedRevisionId !== "string" ||
      !UUID_PATTERN.test(expectedRevisionId))
  ) {
    throw new Error("expectedRevisionId is invalid");
  }
  let password: string | undefined;
  if (input.password !== undefined) {
    if (
      typeof input.password !== "string" ||
      input.password.length < 1 ||
      input.password.length > 1024
    ) {
      throw new Error("password length is invalid");
    }
    password = input.password;
  }
  return {
    host,
    port: input.port,
    securityMode: input.securityMode as SmtpSecurityMode,
    username: text(input.username, "username", 1, 320),
    ...(password === undefined ? {} : { password }),
    fromEmail: email(input.fromEmail, "fromEmail"),
    fromName: text(input.fromName, "fromName", 1, 100),
    expectedRevisionId,
  };
}

export function validateSmtpTestEmailInput(value: unknown): SmtpTestEmailInput {
  const input = record(value);
  const { recipient, ...settings } = input;
  return {
    ...validateSmtpSettingsInput(settings),
    recipient: email(recipient, "recipient"),
  };
}

export function validateDisableSmtpSettingsInput(
  value: unknown,
): DisableSmtpSettingsInput {
  const input = record(value);
  exactKeys(input, ["expectedRevisionId"]);
  if (
    typeof input.expectedRevisionId !== "string" ||
    !UUID_PATTERN.test(input.expectedRevisionId)
  ) {
    throw new Error("expectedRevisionId is invalid");
  }
  return { expectedRevisionId: input.expectedRevisionId };
}
