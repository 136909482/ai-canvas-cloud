import assert from "node:assert/strict";
import test from "node:test";
import { AuthServiceError } from "../auth/service.js";
import { validateCommunityProfilePatch } from "./profileService.js";

test("community profile patch normalizes public nickname and consent", () => {
  assert.deepEqual(
    validateCommunityProfilePatch({
      publicNickname: "  琨哥   Canvas  ",
      communityConsent: true,
    }),
    {
      hasPublicNickname: true,
      publicNickname: "琨哥 Canvas",
      hasCommunityConsent: true,
      communityConsent: true,
    },
  );
});

test("community profile patch supports clearing nickname and revoking consent", () => {
  assert.deepEqual(
    validateCommunityProfilePatch({
      publicNickname: null,
      communityConsent: false,
    }),
    {
      hasPublicNickname: true,
      publicNickname: null,
      hasCommunityConsent: true,
      communityConsent: false,
    },
  );
});

test("community profile patch rejects empty, executable, and unknown input", () => {
  for (const input of [
    {},
    { publicNickname: "<script>" },
    { publicNickname: "name/route" },
    { communityConsent: "yes" },
    { publicNickname: "name", userId: "other" },
  ]) {
    assert.throws(
      () => validateCommunityProfilePatch(input),
      (error) =>
        error instanceof AuthServiceError &&
        error.apiCode === "VALIDATION_FAILED",
    );
  }
});
