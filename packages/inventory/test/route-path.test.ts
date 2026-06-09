import { describe, it, expect } from "vitest";
import { routePathFromFile } from "../src/index.js";

describe("routePathFromFile", () => {
  it("maps a static api route", () => {
    expect(routePathFromFile("app/api/health/route.ts")).toEqual({
      routePath: "/api/health",
      params: [],
    });
  });

  it("maps a dynamic segment", () => {
    expect(routePathFromFile("app/api/orders/[id]/route.ts")).toEqual({
      routePath: "/api/orders/[id]",
      params: ["id"],
    });
  });

  it("maps catch-all and optional catch-all segments", () => {
    expect(routePathFromFile("app/api/docs/[...slug]/route.ts")).toEqual({
      routePath: "/api/docs/[...slug]",
      params: ["slug"],
    });
    expect(routePathFromFile("app/api/files/[[...path]]/route.ts")).toEqual({
      routePath: "/api/files/[[...path]]",
      params: ["path"],
    });
  });

  it("strips route groups and parallel slots", () => {
    expect(routePathFromFile("app/(shop)/api/cart/route.ts")).toEqual({
      routePath: "/api/cart",
      params: [],
    });
    expect(routePathFromFile("app/@modal/api/x/route.ts")).toEqual({
      routePath: "/api/x",
      params: [],
    });
  });

  it("handles root route file", () => {
    expect(routePathFromFile("app/route.ts")).toEqual({ routePath: "/", params: [] });
  });

  it("returns null for non-route files", () => {
    expect(routePathFromFile("app/orders/actions.ts")).toBeNull();
    expect(routePathFromFile("src/api/route.ts")).toBeNull();
  });

  it("accepts js and Windows separators", () => {
    expect(routePathFromFile("app\\api\\ping\\route.js")).toEqual({
      routePath: "/api/ping",
      params: [],
    });
  });
});
