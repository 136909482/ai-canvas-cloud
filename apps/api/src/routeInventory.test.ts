import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_ROUTE_INVENTORY,
  openApiPath,
  publicRouteKey,
} from "./routeInventory.ts";

test("public route inventory is complete, unique, and grouped", () => {
  assert.equal(PUBLIC_ROUTE_INVENTORY.length, 58);
  assert.equal(
    new Set(PUBLIC_ROUTE_INVENTORY.map(publicRouteKey)).size,
    PUBLIC_ROUTE_INVENTORY.length,
  );
  assert.equal(
    new Set(PUBLIC_ROUTE_INVENTORY.map((route) => route.operationId)).size,
    PUBLIC_ROUTE_INVENTORY.length,
  );
  assert.deepEqual(
    Object.fromEntries(
      [
        "system",
        "auth",
        "workspaces",
        "telemetry",
        "announcements",
        "assets",
        "migrations",
        "projects",
        "settings",
      ].map((group) => [
        group,
        PUBLIC_ROUTE_INVENTORY.filter((route) => route.group === group).length,
      ]),
    ),
    {
      system: 6,
      auth: 12,
      workspaces: 2,
      telemetry: 1,
      announcements: 2,
      assets: 5,
      migrations: 14,
      projects: 14,
      settings: 2,
    },
  );
  assert(
    PUBLIC_ROUTE_INVENTORY.every(
      (route) =>
        !route.path.includes("?") && openApiPath(route.path).startsWith("/"),
    ),
  );
});
