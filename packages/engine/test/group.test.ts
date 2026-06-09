import { describe, it, expect } from "vitest";
import { groupEndpoints } from "../src/index.js";
import type { TEndpoint } from "@authzscan/shared";

function ep(overrides: Partial<TEndpoint>): TEndpoint {
  return {
    id: "ep_x",
    kind: "route-handler",
    file: "app/api/x/route.ts",
    method: "GET",
    routePath: "/api/x",
    params: [],
    usesDb: true,
    authIndicators: [],
    ...overrides,
  };
}

describe("groupEndpoints", () => {
  it("groups route handlers by resource path (dynamic segments stripped)", () => {
    const a = ep({ id: "a", routePath: "/api/orders", file: "app/api/orders/route.ts" });
    const b = ep({ id: "b", routePath: "/api/orders/[id]", file: "app/api/orders/[id]/route.ts", params: ["id"] });
    const c = ep({ id: "c", routePath: "/api/users/[id]", file: "app/api/users/[id]/route.ts", params: ["id"] });
    const groups = groupEndpoints([a, b, c]);
    expect(groups.map((g) => g.key)).toEqual(["/api/orders", "/api/users"]);
    expect(groups[0].endpoints.map((e) => e.id)).toEqual(["a", "b"]);
    expect(groups[1].endpoints.map((e) => e.id)).toEqual(["c"]);
  });

  it("groups server actions by their file directory", () => {
    const a = ep({ id: "a", kind: "server-action", method: null, routePath: null, file: "app/orders/actions.ts" });
    const b = ep({ id: "b", kind: "server-action", method: null, routePath: null, file: "app/orders/actions.ts" });
    const groups = groupEndpoints([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("app/orders");
  });

  it("is deterministic: groups sorted by key, endpoints keep input order", () => {
    const a = ep({ id: "a", routePath: "/api/z", file: "app/api/z/route.ts" });
    const b = ep({ id: "b", routePath: "/api/a", file: "app/api/a/route.ts" });
    expect(groupEndpoints([a, b]).map((g) => g.key)).toEqual(["/api/a", "/api/z"]);
  });

  it("skips db-free endpoints with no params (nothing to trace)", () => {
    const skip = ep({ id: "skip", usesDb: false, params: [], routePath: "/api/health", file: "app/api/health/route.ts" });
    const keep = ep({ id: "keep", routePath: "/api/orders/[id]", params: ["id"], file: "app/api/orders/[id]/route.ts" });
    const groups = groupEndpoints([skip, keep]);
    expect(groups.flatMap((g) => g.endpoints.map((e) => e.id))).toEqual(["keep"]);
  });
});
