import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_USER_LIST_DEFAULT_LIMIT,
  ADMIN_USER_LIST_MAX_LIMIT,
  ADMIN_USER_PASSWORD_MAX_LENGTH,
  ADMIN_USER_PASSWORD_MIN_LENGTH,
  validateAdminManagedUserId,
  validateAdminUserActionRequest,
  validateAdminUserDeletionRequest,
  validateAdminUserListQuery,
  validateAdminUserPasswordResetRequest,
} from "./adminOperations.ts";

test("administrator user list query normalizes bounded filters and pagination", () => {
  assert.deepEqual(validateAdminUserListQuery({}), {
    limit: ADMIN_USER_LIST_DEFAULT_LIMIT,
  });
  assert.deepEqual(
    validateAdminUserListQuery({
      cursor: "eyJjcmVhdGVkQXQiOiJ0ZXN0In0",
      limit: String(ADMIN_USER_LIST_MAX_LIMIT),
      status: "disabled",
      verification: "unverified",
      search: "  10001  ",
    }),
    {
      cursor: "eyJjcmVhdGVkQXQiOiJ0ZXN0In0",
      limit: ADMIN_USER_LIST_MAX_LIMIT,
      status: "disabled",
      verification: "unverified",
      search: "10001",
    },
  );
});

test("administrator account deletion requires a strict user-number confirmation and ownership transfers", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(
    validateAdminUserDeletionRequest({
      reason: "账号已完成合规注销核验",
      confirmUserNumber: 10001,
      ownershipTransfers: [{ workspaceId, successorUserId: "member_01" }],
    }),
    {
      reason: "账号已完成合规注销核验",
      confirmUserNumber: 10001,
      ownershipTransfers: [{ workspaceId, successorUserId: "member_01" }],
    },
  );
  assert.throws(
    () =>
      validateAdminUserDeletionRequest({
        reason: "账号已完成合规注销核验",
        confirmUserNumber: "10001",
        ownershipTransfers: [],
      }),
    /confirmUserNumber is invalid/,
  );
  assert.throws(
    () =>
      validateAdminUserDeletionRequest({
        reason: "账号已完成合规注销核验",
        confirmUserNumber: 10001,
        ownershipTransfers: [
          { workspaceId, successorUserId: "member_01" },
          { workspaceId, successorUserId: "member_02" },
        ],
      }),
    /duplicate workspaces/,
  );
});

test("administrator user list query rejects unknown, oversized, and malformed values", () => {
  assert.throws(
    () => validateAdminUserListQuery({ sort: "email" }),
    /unsupported fields/,
  );
  assert.throws(
    () => validateAdminUserListQuery({ limit: 0 }),
    /between 1 and 100/,
  );
  assert.throws(
    () => validateAdminUserListQuery({ cursor: "not a cursor!" }),
    /cursor is invalid/,
  );
  assert.throws(
    () => validateAdminUserListQuery({ status: "banned" }),
    /status is invalid/,
  );
  assert.throws(
    () => validateAdminUserListQuery({ verification: "all" }),
    /verification is invalid/,
  );
  assert.throws(
    () => validateAdminUserListQuery({ search: "x".repeat(129) }),
    /search is invalid/,
  );
});

test("administrator user actions require a strict bounded reason document", () => {
  assert.deepEqual(
    validateAdminUserActionRequest({ reason: "  客服复核后处理  " }),
    { reason: "客服复核后处理" },
  );
  assert.throws(
    () => validateAdminUserActionRequest({ reason: "no", token: "forbidden" }),
    /unsupported fields/,
  );
  assert.throws(
    () => validateAdminUserActionRequest({ reason: "no" }),
    /between 3 and 500/,
  );
  assert.throws(
    () => validateAdminUserActionRequest({ reason: "x".repeat(501) }),
    /between 3 and 500/,
  );
});

test("administrator managed user identifiers are path-safe and bounded", () => {
  assert.equal(validateAdminManagedUserId("user_01-Abc"), "user_01-Abc");
  assert.throws(
    () => validateAdminManagedUserId("../user"),
    /userId is invalid/,
  );
  assert.throws(
    () => validateAdminManagedUserId("x".repeat(129)),
    /userId is invalid/,
  );
});

test("administrator password resets keep the password exact and validate a bounded reason", () => {
  const password = "Temp Password 2026!";
  assert.deepEqual(
    validateAdminUserPasswordResetRequest({
      newPassword: password,
      reason: "  用户完成身份核验  ",
    }),
    { newPassword: password, reason: "用户完成身份核验" },
  );
  assert.throws(
    () =>
      validateAdminUserPasswordResetRequest({
        newPassword: "x".repeat(ADMIN_USER_PASSWORD_MIN_LENGTH - 1),
        reason: "身份核验完成",
      }),
    /between 10 and 256/,
  );
  assert.throws(
    () =>
      validateAdminUserPasswordResetRequest({
        newPassword: "x".repeat(ADMIN_USER_PASSWORD_MAX_LENGTH + 1),
        reason: "身份核验完成",
      }),
    /between 10 and 256/,
  );
  assert.throws(
    () =>
      validateAdminUserPasswordResetRequest({
        newPassword: "valid-password",
        reason: "身份核验完成",
        userId: "forbidden",
      }),
    /unsupported fields/,
  );
});
