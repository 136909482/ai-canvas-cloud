import assert from "node:assert/strict";
import test from "node:test";
import {
  createPostgresPublicSiteConfigService,
  createUnavailablePublicSiteConfigService,
  inspectSiteImage,
} from "./siteConfigService.ts";
import { DEFAULT_SITE_CONFIG } from "@ai-canvas-cloud/contracts";

test("site image inspection verifies PNG and ICO signatures and dimensions", () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(320, 16);
  png.writeUInt32BE(180, 20);
  assert.deepEqual(inspectSiteImage(png, "image/png"), {
    width: 320,
    height: 180,
  });

  const ico = Buffer.alloc(22);
  ico[2] = 1;
  ico[4] = 1;
  ico[6] = 32;
  ico[7] = 32;
  assert.deepEqual(inspectSiteImage(ico, "image/x-icon"), {
    width: 32,
    height: 32,
  });
  assert.throws(() =>
    inspectSiteImage(Buffer.from("not-an-image"), "image/png"),
  );
});

test("unavailable public site configuration uses the built-in safe projection", async () => {
  const response =
    await createUnavailablePublicSiteConfigService().getCurrent();
  assert.equal(response.config.schemaVersion, 2);
  assert.equal(
    response.config.features.registrationEmailVerificationRequired,
    false,
  );
  assert.equal(response.assets.logo, null);
  assert.match(response.etag, /^"[0-9a-f]{64}"$/);
});

test("legacy public site configurations receive a v2 ETag after normalization", async () => {
  const legacyConfig = structuredClone(DEFAULT_SITE_CONFIG) as Record<
    string,
    unknown
  >;
  legacyConfig.schemaVersion = 1;
  legacyConfig.features = {
    registrationEnabled: true,
    feedbackEnabled: false,
  };
  const pool = {
    async query() {
      return {
        rows: [
          {
            etag: '"legacy-v1-etag"',
            config_json: legacyConfig,
            logo_asset_id: null,
            logo_object_key: null,
            logo_mime_type: null,
            favicon_asset_id: null,
            favicon_object_key: null,
            favicon_mime_type: null,
          },
        ],
      };
    },
  };

  const response = await createPostgresPublicSiteConfigService(
    pool as never,
    {} as never,
  ).getCurrent();

  assert.equal(response.config.schemaVersion, 2);
  assert.equal(
    response.config.features.registrationEmailVerificationRequired,
    false,
  );
  assert.match(response.etag, /^"[0-9a-f]{64}"$/);
  assert.notEqual(response.etag, '"legacy-v1-etag"');
});
