import { describe, it, expect } from "vitest";
import { exitCodeForScan, blockingFindings, EXIT } from "../src/exit-code.js";
import type { TFinding } from "@authzscan/shared";

const base: TFinding = {
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

describe("exit codes", () => {
  it("exposes the contract constants", () => {
    expect(EXIT).toEqual({ CLEAN: 0, FINDINGS: 1, ERROR: 2 });
  });

  it("returns CLEAN for empty findings", () => {
    expect(exitCodeForScan([], { analyzed: 3, total: 3, unscanned: [] })).toBe(EXIT.CLEAN);
  });

  it("returns CLEAN when all findings rejected", () => {
    expect(exitCodeForScan([{ ...base, verdict: "rejected" }], { analyzed: 3, total: 3, unscanned: [] })).toBe(EXIT.CLEAN);
  });

  it("returns FINDINGS when any finding confirmed", () => {
    expect(exitCodeForScan([{ ...base, verdict: "rejected" }, base], { analyzed: 3, total: 3, unscanned: [] })).toBe(EXIT.FINDINGS);
  });

  it("returns ERROR when nothing was confirmed but endpoints went unanalyzed", () => {
    expect(exitCodeForScan([], { analyzed: 5, total: 23, unscanned: ["ep1", "ep2"] })).toBe(EXIT.ERROR);
  });

  it("still reports FINDINGS on a partial scan that confirmed something", () => {
    expect(exitCodeForScan([base], { analyzed: 5, total: 23, unscanned: ["ep1"] })).toBe(EXIT.FINDINGS);
  });

  it("does not fail the build on findings below --fail-on", () => {
    const low = { ...base, confidence: "low" as const };
    expect(exitCodeForScan([low], { analyzed: 3, total: 3, unscanned: [] }, "high")).toBe(EXIT.CLEAN);
  });

  it("fails on a finding at exactly the --fail-on level", () => {
    const medium = { ...base, confidence: "medium" as const };
    expect(exitCodeForScan([medium], { analyzed: 3, total: 3, unscanned: [] }, "medium")).toBe(EXIT.FINDINGS);
  });

  it("blockingFindings drops rejected verdicts regardless of confidence", () => {
    expect(blockingFindings([{ ...base, verdict: "rejected" }], "low")).toEqual([]);
  });
});
