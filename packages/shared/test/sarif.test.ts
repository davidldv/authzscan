import { describe, it, expect } from "vitest";
import { toSarif, type TFinding } from "../src/index.js";

function finding(overrides: Partial<TFinding> = {}): TFinding {
  return {
    id: "f1",
    endpointId: "ep1",
    title: "Order fetched without ownership check",
    description: "findUnique keyed only on id.",
    evidence: [
      { file: "app/api/orders/[id]/route.ts", startLine: 12, endLine: 18, note: "no userId filter" },
    ],
    verdict: "confirmed",
    confidence: "high",
    reproduction: "GET other user's order id with own session.",
    suggestedFix: "Scope query by session.user.id.",
    ...overrides,
  };
}

describe("toSarif", () => {
  it("emits required SARIF 2.1.0 envelope", () => {
    const log = toSarif([finding()], { toolVersion: "0.1.0" });
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe("authzscan");
    expect(log.runs[0].tool.driver.version).toBe("0.1.0");
    expect(log.runs[0].tool.driver.rules).toEqual([
      expect.objectContaining({ id: "authzscan/idor" }),
    ]);
  });

  it("maps confidence to level: high=error, medium=warning, low=note", () => {
    const log = toSarif(
      [finding({ id: "a", confidence: "high" }), finding({ id: "b", confidence: "medium" }), finding({ id: "c", confidence: "low" })],
      { toolVersion: "0.1.0" },
    );
    expect(log.runs[0].results.map((r) => r.level)).toEqual(["error", "warning", "note"]);
  });

  it("excludes rejected findings", () => {
    const log = toSarif([finding({ verdict: "rejected" })], { toolVersion: "0.1.0" });
    expect(log.runs[0].results).toHaveLength(0);
  });

  it("maps evidence to physical locations", () => {
    const log = toSarif([finding()], { toolVersion: "0.1.0" });
    expect(log.runs[0].results[0].locations).toEqual([
      {
        physicalLocation: {
          artifactLocation: { uri: "app/api/orders/[id]/route.ts" },
          region: { startLine: 12, endLine: 18 },
        },
      },
    ]);
  });
});
