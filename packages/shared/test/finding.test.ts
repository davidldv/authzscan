import { describe, it, expect } from "vitest";
import { CandidateFinding, Finding, sortFindings, type TFinding } from "../src/index.js";

const candidate = {
  id: "f_orders_id_get_1",
  endpointId: "ep_orders_id_get",
  title: "Order fetched by id without ownership check",
  description: "GET /api/orders/[id] loads prisma.order.findUnique({ where: { id } }) with no userId filter.",
  evidence: [
    {
      file: "app/api/orders/[id]/route.ts",
      startLine: 12,
      endLine: 18,
      note: "findUnique keyed only on params.id",
    },
  ],
};

const confirmed: TFinding = {
  ...candidate,
  verdict: "confirmed",
  confidence: "high",
  reproduction: "As user A (session cookie A), GET /api/orders/<order-id-of-user-B> returns user B's order.",
  suggestedFix: "Add userId to the where clause: prisma.order.findUnique({ where: { id, userId: session.user.id } }).",
};

describe("CandidateFinding schema", () => {
  it("accepts a valid candidate", () => {
    expect(CandidateFinding.parse(candidate)).toEqual(candidate);
  });

  it("rejects empty evidence", () => {
    expect(() => CandidateFinding.parse({ ...candidate, evidence: [] })).toThrow();
  });
});

describe("Finding schema", () => {
  it("accepts a confirmed finding", () => {
    expect(Finding.parse(confirmed)).toEqual(confirmed);
  });

  it("rejects invalid confidence", () => {
    expect(() => Finding.parse({ ...confirmed, confidence: "certain" })).toThrow();
  });
});

describe("sortFindings", () => {
  it("orders high > medium > low and does not mutate input", () => {
    const low: TFinding = { ...confirmed, id: "f_low", confidence: "low" };
    const med: TFinding = { ...confirmed, id: "f_med", confidence: "medium" };
    const input = [low, med, confirmed];
    const sorted = sortFindings(input);
    expect(sorted.map((f) => f.id)).toEqual(["f_orders_id_get_1", "f_med", "f_low"]);
    expect(input.map((f) => f.id)).toEqual(["f_low", "f_med", "f_orders_id_get_1"]);
  });
});
