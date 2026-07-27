import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import type { DbPool } from "../../dist/db/postgres.js";
import { createManagedSmtpAuthEmailService } from "../../dist/modules/auth/email.js";
import {
  createSmtpCredentialKeyring,
  sendSmtpMessage,
  smtpTransportOptions,
  SmtpTransportError,
  verifySmtpConnection,
  type SmtpRuntimeConfig,
} from "../../dist/modules/mail/smtp.js";

const USERNAME = "smtp-fixture";
const PASSWORD = "smtp-fixture-password";

async function createLocalServer(secure: boolean) {
  const messages: string[] = [];
  const server = new SMTPServer({
    secure,
    logger: false,
    disableReverseLookup: true,
    onAuth(auth, _session, callback) {
      if (auth.username === USERNAME && auth.password === PASSWORD) {
        callback(null, { user: USERNAME });
        return;
      }
      callback(
        Object.assign(new Error("Invalid username or password"), {
          responseCode: 535,
        }),
      );
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", callback);
      stream.on("end", () => {
        messages.push(Buffer.concat(chunks).toString("utf8"));
        callback();
      });
    },
  });
  const listener = await new Promise<ReturnType<SMTPServer["listen"]>>(
    (resolve, reject) => {
      const listening = server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve(listening);
      });
      server.once("error", reject);
    },
  );
  const address = listener.address() as AddressInfo;
  return {
    messages,
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(resolve)),
  };
}

function runtimeConfig(
  port: number,
  securityMode: "implicit_tls" | "starttls",
): SmtpRuntimeConfig {
  return {
    revisionId: `${securityMode}-fixture`,
    host: "localhost",
    port,
    securityMode,
    username: USERNAME,
    password: PASSWORD,
    fromEmail: "noreply@example.test",
    fromName: "AI Canvas",
    source: "managed",
  };
}

const localDependencies = {
  async resolveTarget() {
    return { address: "127.0.0.1", family: 4 };
  },
  createTransport(options: ReturnType<typeof smtpTransportOptions>) {
    return nodemailer.createTransport({
      ...options,
      tls: { ...options.tls, rejectUnauthorized: false },
    });
  },
};

test("one-time local SMTP servers cover TLS, STARTTLS, auth failure and auth messages", async () => {
  const implicit = await createLocalServer(true);
  const starttls = await createLocalServer(false);
  try {
    await verifySmtpConnection(
      runtimeConfig(implicit.port, "implicit_tls"),
      localDependencies,
    );
    const starttlsConfig = runtimeConfig(starttls.port, "starttls");
    await verifySmtpConnection(starttlsConfig, localDependencies);
    await assert.rejects(
      () =>
        verifySmtpConnection(
          { ...starttlsConfig, password: "incorrect-password" },
          localDependencies,
        ),
      (error) =>
        error instanceof SmtpTransportError &&
        error.category === "authentication",
    );

    const pool = {
      async query() {
        return { rows: [] };
      },
    } as unknown as DbPool;
    const emailService = createManagedSmtpAuthEmailService(pool, {
      keyring: createSmtpCredentialKeyring({
        developmentSecret: "smtp-local-integration-key",
      }),
      fallbackConfig: starttlsConfig,
      async sendMessage(config, message) {
        await sendSmtpMessage(config, message, localDependencies);
      },
    });
    await emailService.sendRegistrationEmailCode({
      to: "recipient@example.test",
      code: "123456",
      expiresInSeconds: 900,
    });
    await emailService.sendPasswordResetEmail({
      to: "recipient@example.test",
      code: "654321",
      expiresInSeconds: 900,
    });

    assert.equal(starttls.messages.length, 2);
    assert.match(starttls.messages[0]!, /123456/);
    assert.match(starttls.messages[1]!, /654321/);
  } finally {
    await Promise.all([implicit.close(), starttls.close()]);
  }
});
