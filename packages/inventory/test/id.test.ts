import { describe, it, expect } from "vitest";
import { endpointId } from "../src/index.js";

describe("endpointId", () => {
  it("builds a stable slug from file and export name", () => {
    expect(endpointId("app/api/orders/[id]/route.ts", "GET")).toBe(
      "ep_app_api_orders_id_route_ts_get",
    );
  });

  it("is deterministic", () => {
    expect(endpointId("app/orders/actions.ts", "deleteOrder")).toBe(
      endpointId("app/orders/actions.ts", "deleteOrder"),
    );
  });

  it("distinguishes different exports in the same file", () => {
    expect(endpointId("app/api/x/route.ts", "GET")).not.toBe(endpointId("app/api/x/route.ts", "POST"));
  });

  it("normalizes Windows backslashes", () => {
    expect(endpointId("app\\api\\x\\route.ts", "GET")).toBe(endpointId("app/api/x/route.ts", "GET"));
  });
});
