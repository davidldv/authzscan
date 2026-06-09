import { describe, it, expect } from "vitest";
import { Endpoint, AuthProfile, InventoryResult } from "../src/index.js";

const validEndpoint = {
  id: "ep_orders_id_get",
  kind: "route-handler",
  file: "app/api/orders/[id]/route.ts",
  method: "GET",
  routePath: "/api/orders/[id]",
  params: ["id"],
  usesDb: true,
  authIndicators: ["getServerSession"],
};

describe("Endpoint schema", () => {
  it("accepts a valid route handler", () => {
    expect(Endpoint.parse(validEndpoint)).toEqual(validEndpoint);
  });

  it("accepts a server action with null method and routePath", () => {
    const action = {
      ...validEndpoint,
      id: "ep_delete_order_action",
      kind: "server-action",
      file: "app/orders/actions.ts",
      method: null,
      routePath: null,
      params: [],
    };
    expect(Endpoint.parse(action)).toEqual(action);
  });

  it("rejects unknown kind", () => {
    expect(() => Endpoint.parse({ ...validEndpoint, kind: "page" })).toThrow();
  });

  it("rejects unknown HTTP method", () => {
    expect(() => Endpoint.parse({ ...validEndpoint, method: "FETCH" })).toThrow();
  });
});

describe("AuthProfile schema", () => {
  it("accepts a known library profile", () => {
    const profile = {
      library: "next-auth",
      sessionAccessPatterns: ["getServerSession(authOptions)"],
      ownershipIdioms: ["where: { id, userId: session.user.id }"],
    };
    expect(AuthProfile.parse(profile)).toEqual(profile);
  });

  it("rejects unlisted library", () => {
    expect(() =>
      AuthProfile.parse({ library: "passport", sessionAccessPatterns: [], ownershipIdioms: [] }),
    ).toThrow();
  });
});

describe("InventoryResult schema", () => {
  it("accepts endpoints + profile + skipped files", () => {
    const result = {
      endpoints: [validEndpoint],
      authProfile: { library: "custom", sessionAccessPatterns: [], ownershipIdioms: [] },
      skippedFiles: [{ file: "app/api/legacy/route.ts", reason: "parse error: unexpected token" }],
    };
    expect(InventoryResult.parse(result)).toEqual(result);
  });
});
