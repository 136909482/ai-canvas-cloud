import assert from "node:assert/strict";
import test from "node:test";
import {
  BETTER_AUTH_SESSION_COOKIE_NAME,
  createPersonalWorkspaceName,
  normalizeEmail,
  normalizeRegistrationInput,
  validatePassword,
} from "./service.ts";

test("normalizes and validates registration input before Better Auth receives it", () => {
  const normalized = normalizeRegistrationInput({
    email: " User@Example.COM ",
    password: "long-enough-password",
  });

  assert.equal(normalized.emailNormalized, "user@example.com");
  assert.equal(normalized.password, "long-enough-password");
});

test("rejects invalid email and short password", () => {
  assert.throws(() => normalizeEmail("not-an-email"), /Invalid email/);
  assert.throws(() => validatePassword("short"), /at least/);
});

test("uses Better Auth session cookie name", () => {
  assert.equal(BETTER_AUTH_SESSION_COOKIE_NAME, "better-auth.session_token");
});

test("derives personal workspace names from normalized email", () => {
  assert.equal(
    createPersonalWorkspaceName("artist@example.com"),
    "artist 的个人空间",
  );
});
