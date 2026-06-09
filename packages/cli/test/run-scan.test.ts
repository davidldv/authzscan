import { describe, it, expect } from "vitest";
import { buildScanSummary } from "../src/run-scan.js";
import { EXIT } from "../src/exit-code.js";
import type { TFinding } from "@authzscan/shared";

const finding: TFinding = {
  id: "f1",
  endpointId: "ep1",
  title: "t",
  description: "d",
  evidence: [{ file: "a.ts", startLine: 1, endLine: 2, note: "n" }],
  verdict: "confirmed",
  confidence: "high",
  reproduction: "r",
  suggestedFix: "s",
};

describe("buildScanSummary", () => {
  it("summarizes a dirty scan with exit code 1", () => {
    const s = buildScanSummary({
      findings: [finding],
      coverage: { analyzed: 4, total: 4, unscanned: [] },
      spentUsd: 1.23,
    });
    expect(s.exitCode).toBe(EXIT.FINDINGS);
    expect(s.text).toContain("1 confirmed finding");
    expect(s.text).toContain("4/4 endpoints analyzed");
    expect(s.text).toContain("$1.23");
  });

  it("summarizes a clean scan with exit code 0", () => {
    const s = buildScanSummary({
      findings: [{ ...finding, verdict: "rejected" }],
      coverage: { analyzed: 4, total: 4, unscanned: [] },
      spentUsd: 0.5,
    });
    expect(s.exitCode).toBe(EXIT.CLEAN);
    expect(s.text).toContain("No confirmed findings");
  });

  it("warns loudly when coverage is partial", () => {
    const s = buildScanSummary({
      findings: [],
      coverage: { analyzed: 2, total: 4, unscanned: ["a", "b"] },
      spentUsd: 0,
    });
    expect(s.text).toMatch(/2 endpoint\(s\) NOT analyzed/);
  });
});
