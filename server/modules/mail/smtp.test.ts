import assert from "node:assert/strict";
import test from "node:test";
import {
  createSmtpCredentialKeyring,
  createRevisionCachedSmtpSender,
  decryptSmtpPassword,
  encryptSmtpPassword,
  resolvePublicSmtpTarget,
  smtpTransportOptions,
  SmtpTransportError,
} from "../../dist/modules/mail/smtp.js";

function smtpConfig() {
  return {
    revisionId,
    host: "smtp.example.com",
    port: 465,
    securityMode: "implicit_tls" as const,
    username: "mailer@example.com",
    password: "secret",
    fromEmail: "noreply@example.com",
    fromName: "AI Canvas",
    source: "managed" as const,
  };
}

const revisionId = "123e4567-e89b-42d3-a456-426614174000";
const serializedKeys = JSON.stringify({
  1: Buffer.alloc(32, 1).toString("base64"),
  2: Buffer.alloc(32, 2).toString("base64"),
});

test("SMTP credentials use authenticated versioned encryption", () => {
  const keyring = createSmtpCredentialKeyring({
    serializedKeys,
    activeVersion: 2,
  });
  const envelope = encryptSmtpPassword("private-password", revisionId, keyring);
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.equal(envelope.keyVersion, 2);
  assert.equal(
    decryptSmtpPassword(envelope, revisionId, keyring),
    "private-password",
  );
  assert.equal(JSON.stringify(envelope).includes("private-password"), false);
  assert.throws(() =>
    decryptSmtpPassword(
      { ...envelope, ciphertext: Buffer.from("tampered").toString("base64") },
      revisionId,
      keyring,
    ),
  );
});

test("SMTP keyring validates active key material and supports development isolation", () => {
  assert.throws(
    () =>
      createSmtpCredentialKeyring({
        serializedKeys: JSON.stringify({ 1: "short" }),
      }),
    /32 bytes/,
  );
  const development = createSmtpCredentialKeyring({
    developmentSecret: "local-test-secret",
  });
  assert.equal(development.keys.get(1)?.byteLength, 32);
});

test("SMTP target validation accepts public addresses and blocks private resolution", async () => {
  const publicTarget = await resolvePublicSmtpTarget(
    "smtp.example.com",
    (async () => [{ address: "8.8.8.8", family: 4 }]) as never,
  );
  assert.equal(publicTarget.address, "8.8.8.8");
  const publicIpv6Target = await resolvePublicSmtpTarget(
    "smtp.example.com",
    (async () => [{ address: "2001:4860:4860::8888", family: 6 }]) as never,
  );
  assert.equal(publicIpv6Target.family, 6);
  await assert.rejects(
    () =>
      resolvePublicSmtpTarget("smtp.example.com", (async () => [
        { address: "127.0.0.1", family: 4 },
      ]) as never),
    (error) =>
      error instanceof SmtpTransportError &&
      error.category === "host_not_allowed",
  );
  await assert.rejects(
    () =>
      resolvePublicSmtpTarget("smtp.example.com", (async () => [
        { address: "2001:db8::1", family: 6 },
      ]) as never),
    (error) =>
      error instanceof SmtpTransportError &&
      error.category === "host_not_allowed",
  );
  for (const host of ["::ffff:127.0.0.1", "64:ff9b::7f00:1"]) {
    await assert.rejects(
      () => resolvePublicSmtpTarget(host),
      (error) =>
        error instanceof SmtpTransportError &&
        error.category === "host_not_allowed",
    );
  }
});

test("SMTP transport maps TLS modes and caches transporters by revision", async () => {
  const config = smtpConfig();
  const implicit = smtpTransportOptions(config, "8.8.8.8");
  assert.equal(implicit.secure, true);
  assert.equal(implicit.requireTLS, false);
  assert.equal(implicit.tls.minVersion, "TLSv1.2");
  assert.equal(implicit.tls.rejectUnauthorized, true);
  assert.equal(implicit.tls.servername, "smtp.example.com");
  const starttls = smtpTransportOptions(
    { ...config, port: 587, securityMode: "starttls" },
    "8.8.8.8",
  );
  assert.equal(starttls.secure, false);
  assert.equal(starttls.requireTLS, true);

  let lookups = 0;
  let created = 0;
  let closed = 0;
  let sends = 0;
  const sender = createRevisionCachedSmtpSender({
    lookup: (async () => {
      lookups += 1;
      return [{ address: "8.8.8.8", family: 4 }];
    }) as never,
    createTransport() {
      created += 1;
      return {
        close() {
          closed += 1;
        },
        async sendMail() {
          sends += 1;
          return {};
        },
      } as never;
    },
  });
  const message = {
    to: "recipient@example.com",
    subject: "SMTP test",
    text: "Delivered",
  };
  await sender.send(config, message);
  await sender.send(config, message);
  assert.deepEqual(
    { lookups, created, sends },
    { lookups: 2, created: 1, sends: 2 },
  );
  await sender.send({ ...config, revisionId: "next-revision" }, message);
  assert.deepEqual(
    { lookups, created, sends, closed },
    { lookups: 3, created: 2, sends: 3, closed: 1 },
  );
  sender.close();
  assert.equal(closed, 2);
});

test("revision-cached SMTP sender never retries a failed send", async () => {
  let sends = 0;
  const sender = createRevisionCachedSmtpSender({
    lookup: (async () => [{ address: "8.8.8.8", family: 4 }]) as never,
    createTransport() {
      return {
        close() {},
        async sendMail() {
          sends += 1;
          throw Object.assign(new Error("authentication failed"), {
            code: "EAUTH",
          });
        },
      } as never;
    },
  });
  const config = smtpConfig();
  await assert.rejects(
    () =>
      sender.send(config, {
        to: "recipient@example.com",
        subject: "SMTP test",
        text: "Delivered",
      }),
    (error) =>
      error instanceof SmtpTransportError &&
      error.category === "authentication",
  );
  assert.equal(sends, 1);
});
