import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runInventory } from "../src/index.js";
import { InventoryResult } from "@authzscan/shared";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "basic-app");

describe("runInventory", () => {
  it("produces a schema-valid InventoryResult", () => {
    const result = runInventory(fixture);
    expect(() => InventoryResult.parse(result)).not.toThrow();
  });

  it("finds all endpoints with correct shapes", () => {
    const result = runInventory(fixture);
    const ids = result.endpoints.map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        "ep_app_api_health_route_ts_get",
        "ep_app_api_orders_id_route_ts_get",
        "ep_app_api_orders_id_route_ts_delete",
        "ep_app_orders_actions_ts_deleteorder",
      ].sort(),
    );

    const orderGet = result.endpoints.find((e) => e.id === "ep_app_api_orders_id_route_ts_get");
    expect(orderGet).toEqual({
      id: "ep_app_api_orders_id_route_ts_get",
      kind: "route-handler",
      file: "app/api/orders/[id]/route.ts",
      method: "GET",
      routePath: "/api/orders/[id]",
      params: ["id"],
      usesDb: true,
      authIndicators: ["getServerSession"],
    });

    const action = result.endpoints.find((e) => e.id === "ep_app_orders_actions_ts_deleteorder");
    expect(action).toEqual({
      id: "ep_app_orders_actions_ts_deleteorder",
      kind: "server-action",
      file: "app/orders/actions.ts",
      method: null,
      routePath: null,
      params: [],
      usesDb: true,
      authIndicators: ["getServerSession"],
    });

    const health = result.endpoints.find((e) => e.id === "ep_app_api_health_route_ts_get");
    expect(health?.usesDb).toBe(false);
    expect(health?.authIndicators).toEqual([]);
  });

  it("builds the auth profile from the fixture", () => {
    const result = runInventory(fixture);
    expect(result.authProfile.library).toBe("next-auth");
    expect(result.authProfile.sessionAccessPatterns).toEqual(["getServerSession"]);
    expect(result.authProfile.ownershipIdioms).toEqual(["{ id, userId: session.user.id }"]);
  });

  it("reports no skipped files for the clean fixture", () => {
    const result = runInventory(fixture);
    expect(result.skippedFiles).toEqual([]);
  });

  it("throws a clear error when app/ is missing", () => {
    expect(() => runInventory(path.dirname(fixture))).toThrow(/no app\/ directory/i);
  });
});
