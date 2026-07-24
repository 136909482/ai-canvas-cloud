import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnavailablePublicSiteConfigService,
  inspectSiteImage,
} from "./siteConfigService.ts";

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
  assert.equal(response.config.schemaVersion, 1);
  assert.equal(response.assets.logo, null);
  assert.match(response.etag, /^"[0-9a-f]{64}"$/);
});
