import assert from "node:assert/strict";
import test from "node:test";
import {
  validateObjectStorageSettingsInput,
  validateRestoreEnvironmentObjectStorageInput,
} from "./objectStorageSettings.ts";

const valid = {
  endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
  publicEndpoint: "https://oss-cn-hangzhou.aliyuncs.com",
  publicOrigin: "https://ai-canvas-assets.oss-cn-hangzhou.aliyuncs.com",
  region: "cn-hangzhou",
  bucket: "ai-canvas-assets",
  forcePathStyle: false,
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  expectedRevisionId: null,
};

test("object storage settings normalize supported input", () => {
  assert.deepEqual(validateObjectStorageSettingsInput(valid), valid);
});

test("object storage credentials must be submitted as a pair", () => {
  assert.throws(
    () =>
      validateObjectStorageSettingsInput({
        ...valid,
        secretAccessKey: undefined,
      }),
    /provided together/,
  );
});

test("object storage settings reject paths in the public origin", () => {
  assert.throws(
    () =>
      validateObjectStorageSettingsInput({
        ...valid,
        publicOrigin: "https://assets.example.com/private",
      }),
    /must be an origin/,
  );
});

test("restore environment input requires a revision", () => {
  assert.deepEqual(
    validateRestoreEnvironmentObjectStorageInput({
      expectedRevisionId: "123e4567-e89b-42d3-a456-426614174000",
    }),
    { expectedRevisionId: "123e4567-e89b-42d3-a456-426614174000" },
  );
});
