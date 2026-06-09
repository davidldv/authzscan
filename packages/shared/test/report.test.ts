import { describe, it, expect } from "vitest";
import { renderReport, type TFinding } from "../src/index.js";

const confirmed: TFinding = {
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
};

const input = {
  repoPath: "C:/Users/Alejandro/Dev/labodega",
  generatedAt: "2026-06-09T12:00:00Z",
  coverage: { analyzed: 44, total: 47, unscanned: ["ep_x", "ep_y", "ep_z"] },
  findings: [confirmed, { ...confirmed, id: "f2", verdict: "rejected" as const }],
};

describe("renderReport", () => {
  it("renders deterministic markdown snapshot", () => {
    expect(renderReport(input)).toMatchSnapshot();
  });

  it("states coverage explicitly", () => {
    const md = renderReport(input);
    expect(md).toContain("44/47 endpoints analyzed");
    expect(md).toContain("3 not scanned");
  });

  it("counts only confirmed findings in summary", () => {
    const md = renderReport(input);
    expect(md).toContain("1 confirmed finding");
  });

  it("reports clean when nothing confirmed", () => {
    const md = renderReport({ ...input, findings: [] });
    expect(md).toContain("No confirmed findings");
  });
});
