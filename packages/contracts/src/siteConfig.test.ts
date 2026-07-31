import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SITE_LINK_PATHS,
  DEFAULT_SITE_CONFIG,
  validateSiteConfigDocument,
} from "./siteConfig.ts";

test("site configuration runtime schema normalizes the complete safe document", () => {
  const config = validateSiteConfigDocument(
    structuredClone(DEFAULT_SITE_CONFIG),
  );
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.siteName, "AI Canvas");
  assert.deepEqual(config.navigation, ["home", "help", "legal"]);
  assert.deepEqual(DEFAULT_SITE_LINK_PATHS, {
    helpUrl: "/help",
    feedbackUrl: "/feedback",
    termsUrl: "/yonghuxieyi",
    privacyUrl: "/yinsizhengce",
  });
});

test("site configuration rejects executable content, unknown fields, and credential URLs", () => {
  assert.throws(() =>
    validateSiteConfigDocument({
      ...DEFAULT_SITE_CONFIG,
      siteName: "<script>alert(1)</script>",
    }),
  );
  assert.throws(() =>
    validateSiteConfigDocument({ ...DEFAULT_SITE_CONFIG, unknown: true }),
  );
  assert.throws(() =>
    validateSiteConfigDocument({
      ...DEFAULT_SITE_CONFIG,
      links: {
        ...DEFAULT_SITE_CONFIG.links,
        helpUrl: "https://user:pass@example.com/help",
      },
    }),
  );
});
