import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SITE_CONFIG } from "@ai-canvas-cloud/contracts/site-config";
import { getPublicPageHref, getPublicPageKind } from "./publicPages.ts";

test("public content paths resolve with or without a trailing slash", () => {
  assert.equal(getPublicPageKind("/help"), "help");
  assert.equal(getPublicPageKind("/yonghuxieyi/"), "terms");
  assert.equal(getPublicPageKind("/yinsizhengce"), "privacy");
  assert.equal(getPublicPageKind("/feedback"), "feedback");
  assert.equal(getPublicPageKind("/unknown"), null);
});

test("public content links prefer administrator URLs and otherwise stay local", () => {
  assert.equal(getPublicPageHref(DEFAULT_SITE_CONFIG, "help"), "/help");
  assert.equal(
    getPublicPageHref(
      {
        ...DEFAULT_SITE_CONFIG,
        links: {
          ...DEFAULT_SITE_CONFIG.links,
          helpUrl: "https://support.example.com/knowledge",
        },
      },
      "help",
    ),
    "https://support.example.com/knowledge",
  );
});
