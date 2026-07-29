import assert from "node:assert/strict";
import test from "node:test";
import {
  BETTER_AUTH_SESSION_COOKIE_NAME,
  createPersonalWorkspaceName,
  normalizeEmail,
  normalizeLoginIdentifier,
  normalizeRegistrationInput,
  normalizeUsername,
  validatePassword,
} from "./service.ts";

test("normalizes and validates registration input before Better Auth receives it", () => {
  const normalized = normalizeRegistrationInput({
    username: " Artist_01 ",
    email: " User@Example.COM ",
    password: "long-enough-password",
    acceptedTermsAndPrivacy: true,
  });

  assert.equal(normalized.usernameNormalized, "artist_01");
  assert.equal(normalized.displayUsername, "Artist_01");
  assert.equal(normalized.emailNormalized, "user@example.com");
  assert.equal(normalized.password, "long-enough-password");
});

test("rejects registration before account creation without legal consent", () => {
  assert.throws(
    () =>
      normalizeRegistrationInput({
        username: "Artist_01",
        email: "artist@example.com",
        password: "long-enough-password",
        acceptedTermsAndPrivacy: false,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "User agreement and privacy policy must be accepted",
  );
});

test("rejects invalid email and short password", () => {
  assert.throws(() => normalizeEmail("not-an-email"), /Invalid email/);
  assert.throws(() => validatePassword("short"), /at least/);
});

test("validates usernames and rejects reserved values case-insensitively", () => {
  assert.deepEqual(normalizeUsername("Hello_01"), {
    usernameNormalized: "hello_01",
    displayUsername: "Hello_01",
  });

  for (const invalid of [
    "ab",
    "1artist",
    "_artist",
    "artist-name",
    "a".repeat(31),
    "ADMIN",
    "system",
  ]) {
    assert.throws(() => normalizeUsername(invalid));
  }
});

test("routes login identifiers without exposing invalid account existence", () => {
  assert.deepEqual(normalizeLoginIdentifier(" Artist@Example.COM "), {
    type: "email",
    value: "artist@example.com",
  });
  assert.deepEqual(normalizeLoginIdentifier(" Artist_01 "), {
    type: "username",
    value: "artist_01",
  });

  for (const invalid of ["", "1artist", "invalid@", undefined]) {
    assert.throws(
      () => normalizeLoginIdentifier(invalid as string),
      /Invalid account or password/,
    );
  }
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
