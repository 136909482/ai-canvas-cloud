import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStaticSite } from "./staticSite.ts";

function request(port: number, path: string) {
  return new Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      })
      .on("error", reject);
  });
}

test("static site serves assets, protects paths, and preserves SPA fallback headers", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai-canvas-static-site-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<main>canvas</main>");
  writeFileSync(join(root, "assets", "app.js"), "console.log('canvas')");
  writeFileSync(join(root, "secret.txt"), "not outside root");
  const site = createStaticSite({
    root,
    contentSecurityPolicy: "default-src 'self'",
    environment: "production",
  });
  const server = http.createServer((request_, response) =>
    site.handle(request_, response, request_.url ?? "/"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const asset = await request(address.port, "/assets/app.js");
    assert.equal(asset.statusCode, 200);
    assert.equal(
      asset.headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
    assert.match(asset.headers["content-security-policy"] ?? "", /default-src/);

    const applicationRoute = await request(address.port, "/projects/project-1");
    assert.equal(applicationRoute.statusCode, 200);
    assert.equal(applicationRoute.headers["cache-control"], "no-store");
    assert.equal(applicationRoute.body, "<main>canvas</main>");

    const missingAsset = await request(address.port, "/assets/missing.js");
    assert.equal(missingAsset.statusCode, 404);

    const traversal = await request(address.port, "/%2e%2e/secret.txt");
    assert.notEqual(traversal.body, "not outside root");

    const nullByte = await request(address.port, "/%00");
    assert.equal(nullByte.statusCode, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
