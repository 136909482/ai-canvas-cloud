import assert from "node:assert/strict";
import test from "node:test";
import {
  validateDisableSmtpSettingsInput,
  validateSmtpSettingsInput,
  validateSmtpTestEmailInput,
} from "./smtpSettings.ts";

const revisionId = "123e4567-e89b-42d3-a456-426614174000";
const valid = {
  host: "SMTP.Example.com",
  port: 465,
  securityMode: "implicit_tls",
  username: "mailer@example.com",
  password: "app-password",
  fromEmail: "NoReply@Example.com",
  fromName: "AI Canvas",
  expectedRevisionId: revisionId,
};

test("SMTP settings normalize bounded standard credentials", () => {
  assert.deepEqual(validateSmtpSettingsInput(valid), {
    ...valid,
    host: "smtp.example.com",
    fromEmail: "noreply@example.com",
  });
  assert.deepEqual(
    validateDisableSmtpSettingsInput({ expectedRevisionId: revisionId }),
    { expectedRevisionId: revisionId },
  );
  assert.equal(
    validateSmtpSettingsInput({ ...valid, host: "2001:4860:4860::8888" }).host,
    "2001:4860:4860::8888",
  );
});

test("SMTP settings reject unsupported ports, plaintext modes and extra fields", () => {
  assert.throws(
    () => validateSmtpSettingsInput({ ...valid, port: 443 }),
    /port/,
  );
  assert.throws(
    () => validateSmtpSettingsInput({ ...valid, securityMode: "none" }),
    /securityMode/,
  );
  assert.throws(
    () => validateSmtpSettingsInput({ ...valid, targetUrl: "smtp://internal" }),
    /not supported/,
  );
  assert.throws(
    () => validateSmtpSettingsInput({ ...valid, host: "999.1.1.1" }),
    /host/,
  );
});

test("SMTP test email validates its recipient separately", () => {
  assert.equal(
    validateSmtpTestEmailInput({ ...valid, recipient: "TEST@example.com" })
      .recipient,
    "test@example.com",
  );
  assert.throws(
    () => validateSmtpTestEmailInput({ ...valid, recipient: "invalid" }),
    /recipient/,
  );
});
