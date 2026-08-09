import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  CommunityProfileResponseSchema,
  UpdateCommunityProfileRequestSchema,
} from "./httpSchema.ts";

test("community profile contract exposes only public identity and consent state", () => {
  assert.equal(
    Value.Check(CommunityProfileResponseSchema, {
      profile: {
        publicNickname: "琨哥 Canvas",
        profileStatus: "active",
        communityConsentVersion: 1,
        communityConsentAt: "2026-08-09T12:00:00.000Z",
        canPost: true,
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
    }),
    true,
  );
});

test("community profile patch accepts nickname and versioned-consent controls", () => {
  assert.equal(
    Value.Check(UpdateCommunityProfileRequestSchema, {
      publicNickname: "Canvas User",
      communityConsent: true,
    }),
    true,
  );
  assert.equal(
    Value.Check(UpdateCommunityProfileRequestSchema, {
      publicNickname: null,
    }),
    true,
  );
});

test("community profile patch rejects empty, oversized and identity input", () => {
  assert.equal(Value.Check(UpdateCommunityProfileRequestSchema, {}), false);
  assert.equal(
    Value.Check(UpdateCommunityProfileRequestSchema, {
      publicNickname: "x".repeat(33),
    }),
    false,
  );
  assert.equal(
    Value.Check(UpdateCommunityProfileRequestSchema, {
      userId: "other-user",
      communityConsent: true,
    }),
    false,
  );
});
