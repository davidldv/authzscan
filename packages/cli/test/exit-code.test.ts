import { describe, it, expect } from "vitest";
import { exitCodeForFindings, EXIT } from "../src/exit-code.js";
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
    expect(exitCodeForFindings([])).toBe(EXIT.CLEAN);
  });

  it("returns CLEAN when all findings rejected", () => {
    expect(exitCodeForFindings([{ ...base, verdict: "rejected" }])).toBe(EXIT.CLEAN);
  });

  it("returns FINDINGS when any finding confirmed", () => {
    expect(exitCodeForFindings([{ ...base, verdict: "rejected" }, base])).toBe(EXIT.FINDINGS);
  });
});
