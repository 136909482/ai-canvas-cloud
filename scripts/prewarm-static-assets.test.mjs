import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  listAssetPaths,
  prewarmStaticAssets,
} from "./prewarm-static-assets.mjs";

function makeDist(name, assets) {
  const root = mkdtempSync(join(tmpdir(), `ai-canvas-prewarm-${name}-`));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), `<main>${name}</main>`);
  for (const asset of assets) {
    writeFileSync(join(root, "assets", asset), asset);
  }
  return root;
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("prewarm covers both HTML pages and every hashed asset with retries", async () => {
  const publicDist = makeDist("public", ["public-a1.js", "retry-b2.css"]);
  const adminDist = makeDist("admin", ["admin-c3.js", "failed-d4.css"]);
  const requests = new Map();
  const { server, origin } = await listen((request, response) => {
    const pathname = new URL(request.url ?? "/", origin).pathname;
    requests.set(pathname, (requests.get(pathname) ?? 0) + 1);
    if (pathname === "/assets/retry-b2.css" && requests.get(pathname) === 1) {
      response.writeHead(503).end("retry");
      return;
    }
    if (pathname === "/assets/failed-d4.css") {
      response.writeHead(500).end("failed");
      return;
    }
    response.writeHead(200).end("ok");
  });
  const messages = [];

  try {
    const result = await prewarmStaticAssets({
      sites: [
        {
          name: "public",
          publicUrl: `${origin}/public?token=must-not-log`,
          distDirectory: publicDist,
        },
        {
          name: "admin",
          publicUrl: `${origin}/admin?token=must-not-log`,
          distDirectory: adminDist,
        },
      ],
      concurrency: 4,
      timeoutMs: 5_000,
      retries: 2,
      retryDelayMs: 0,
      logger: {
        info: (message) => messages.push(message),
        warn: (message) => messages.push(message),
      },
    });

    assert.deepEqual(listAssetPaths(publicDist), [
      "/assets/public-a1.js",
      "/assets/retry-b2.css",
    ]);
    assert.equal(requests.get("/public"), 1);
    assert.equal(requests.get("/admin"), 1);
    assert.equal(requests.get("/assets/public-a1.js"), 1);
    assert.equal(requests.get("/assets/admin-c3.js"), 1);
    assert.equal(requests.get("/assets/retry-b2.css"), 2);
    assert.equal(requests.get("/assets/failed-d4.css"), 3);
    assert.equal(result.succeeded, 5);
    assert.equal(result.failed, 1);
    assert.equal(result.total, 6);
    assert.doesNotMatch(messages.join("\n"), /token|must-not-log|\?/);
    assert.match(messages.at(-1), /succeeded=5 failed=1 total=6/);
  } finally {
    await close(server);
    rmSync(publicDist, { recursive: true, force: true });
    rmSync(adminDist, { recursive: true, force: true });
  }
});

test("prewarm retries timed out resources and reports a warning result", async () => {
  const dist = makeDist("slow", ["slow-a1.js"]);
  let timedOutRequests = 0;
  const fetchImpl = (url, init) => {
    if (url.pathname !== "/assets/slow-a1.js") {
      return Promise.resolve(new Response("ok", { status: 200 }));
    }

    timedOutRequests += 1;
    return new Promise((_, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  };

  try {
    const result = await prewarmStaticAssets({
      sites: [
        {
          name: "public",
          publicUrl: "https://canvas.example.com",
          distDirectory: dist,
        },
      ],
      concurrency: 4,
      timeoutMs: 10,
      retries: 2,
      retryDelayMs: 0,
      fetchImpl,
      logger: { info() {}, warn() {} },
    });
    assert.equal(timedOutRequests, 3);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
