import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const defaultSource = resolve(".env");
const defaultPublicDestination = resolve("/runtime/public.env");
const defaultAdminDestination = resolve("/runtime/admin.env");

const publicKeys = [
  "NODE_ENV",
  "DEPLOYMENT_ENV",
  "LOG_LEVEL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "WEB_PUBLIC_URL",
  "WEB_ALLOWED_ORIGINS",
  "DATABASE_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_PUBLIC_ORIGIN",
  "S3_FORCE_PATH_STYLE",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION",
  "OBJECT_STORAGE_CREDENTIAL_KEYS",
  "AUTH_EMAIL_TRANSPORT",
  "SMTP_CREDENTIAL_ACTIVE_KEY_VERSION",
  "SMTP_CREDENTIAL_KEYS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_FROM",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "DEPLOYMENT_RESOURCE_NAMESPACE",
  "DEPLOYMENT_CREDENTIAL_NAMESPACE",
  "DATABASE_RESOURCE_ID",
  "REDIS_RESOURCE_ID",
  "S3_RESOURCE_ID",
  "MAIL_RESOURCE_ID",
  "PERSISTENCE_RESOURCE_ID",
  "DATABASE_CREDENTIAL_ID",
  "REDIS_CREDENTIAL_ID",
  "S3_CREDENTIAL_ID",
  "MAIL_CREDENTIAL_ID",
];

const adminKeys = [
  "NODE_ENV",
  "DEPLOYMENT_ENV",
  "LOG_LEVEL",
  "APP_DATABASE_ROLE",
  "ADMIN_DATABASE_URL",
  "ADMIN_BETTER_AUTH_URL",
  "ADMIN_BETTER_AUTH_SECRET",
  "ADMIN_WEB_PUBLIC_URL",
  "ADMIN_WEB_ALLOWED_ORIGINS",
  "WEB_ALLOWED_ORIGINS",
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_PUBLIC_ORIGIN",
  "S3_FORCE_PATH_STYLE",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_CREDENTIAL_ACTIVE_KEY_VERSION",
  "OBJECT_STORAGE_CREDENTIAL_KEYS",
  "SMTP_CREDENTIAL_ACTIVE_KEY_VERSION",
  "SMTP_CREDENTIAL_KEYS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_FROM",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
];

const optionalKeys = new Set([
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_FROM",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
]);

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a path`);
  return resolve(value);
}

function parseEnv(path) {
  if (!existsSync(path)) throw new Error(`Missing environment file: ${path}`);
  const values = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    values.set(
      trimmed.slice(0, separator).trim(),
      trimmed.slice(separator + 1),
    );
  }
  return values;
}

function required(values, key) {
  const value = values.get(key);
  if (value === undefined || value.trim().length === 0)
    throw new Error(`Missing required runtime configuration: ${key}`);
  if (value.includes("\n") || value.includes("\r"))
    throw new Error(
      `Runtime configuration must not contain line breaks: ${key}`,
    );
  return value;
}

function writeEnvironment(path, values, keys, additions) {
  const lines = [
    "# Generated from release.env. Do not edit or commit this file.",
    ...Object.entries(additions).map(([key, value]) => `${key}=${value}`),
    ...keys.map(
      (key) =>
        `${key}=${optionalKeys.has(key) ? (values.get(key) ?? "") : required(values, key)}`,
    ),
    "",
  ];
  writeFileSync(path, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
}

const source = argumentValue("--source", defaultSource);
const publicDestination = argumentValue("--public", defaultPublicDestination);
const adminDestination = argumentValue("--admin", defaultAdminDestination);
const values = parseEnv(source);

if (
  required(values, "BETTER_AUTH_SECRET") ===
  required(values, "ADMIN_BETTER_AUTH_SECRET")
) {
  throw new Error(
    "BETTER_AUTH_SECRET and ADMIN_BETTER_AUTH_SECRET must differ",
  );
}
if (
  required(values, "APP_DATABASE_ROLE") ===
  required(values, "ADMIN_DATABASE_ROLE")
) {
  throw new Error("APP_DATABASE_ROLE and ADMIN_DATABASE_ROLE must differ");
}

writeEnvironment(publicDestination, values, publicKeys, {
  API_HOST: "0.0.0.0",
  API_PORT: "8080",
  API_TRUST_PROXY: "true",
  WEB_STATIC_SITE_ROOT: "/app/apps/web/dist",
});
writeEnvironment(adminDestination, values, adminKeys, {
  ADMIN_API_HOST: "0.0.0.0",
  ADMIN_API_PORT: "8081",
  ADMIN_API_TRUST_PROXY: "true",
  ADMIN_STATIC_SITE_ROOT: "/app/apps/admin-web/dist",
});

console.log(
  `Runtime environment files written to ${dirname(publicDestination)} and ${dirname(adminDestination)}.`,
);
