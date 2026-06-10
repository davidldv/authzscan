import { describe, it, expect } from "vitest";
import { classifyFindings, computeMetrics } from "../src/index.js";
import type { TManifest } from "../src/index.js";
import type { TFinding } from "@authzscan/shared";

const manifest: TManifest = {
  vulns: [
    { id: "V1", file: "app/a.ts", type: "t", difficulty: "easy", description: "d" },
    { id: "V2", file: "app/b.ts", type: "t", difficulty: "medium", description: "d" },
    { id: "V3", file: "app/c.ts", type: "t", difficulty: "hard", description: "d" },
  ],
  cleanFiles: ["app/clean.ts"],
};

function finding(id: string, file: string, verdict: "confirmed" | "rejected" = "confirmed"): TFinding {
  return {
    id,
    endpointId: "ep",
    title: "t",
    description: "d",
    evidence: [{ file, startLine: 1, endLine: 2, note: "n" }],
    verdict,
    confidence: "high",
    reproduction: "r",
    suggestedFix: "s",
  };
}

describe("classifyFindings", () => {
  it("classifies TP (vuln file), FP (clean file), unknown (other file); ignores rejected", () => {
    const c = classifyFindings(
      [
        finding("f1", "app/a.ts"),
        finding("f2", "app/clean.ts"),
        finding("f3", "app/mystery.ts"),
        finding("f4", "app/b.ts", "rejected"),
      ],
      manifest,
    );
    expect(c.matchedVulnIds).toEqual(["V1"]);
    expect(c.truePositives.map((f) => f.id)).toEqual(["f1"]);
    expect(c.falsePositives.map((f) => f.id)).toEqual(["f2"]);
    expect(c.unknowns.map((f) => f.id)).toEqual(["f3"]);
  });

  it("credits a vuln only once for multiple findings on the same file", () => {
    const c = classifyFindings([finding("f1", "app/a.ts"), finding("f2", "app/a.ts")], manifest);
    expect(c.matchedVulnIds).toEqual(["V1"]);
    expect(c.truePositives).toHaveLength(2);
  });
});

describe("computeMetrics", () => {
  it("computes recall, precision (unknowns count against), per-difficulty recall", () => {
    const c = classifyFindings(
      [finding("f1", "app/a.ts"), finding("f2", "app/b.ts"), finding("f3", "app/mystery.ts")],
      manifest,
    );
    const m = computeMetrics(c, manifest);
    expect(m.recall).toBeCloseTo(2 / 3, 5);
    expect(m.precision).toBeCloseTo(2 / 3, 5); // 2 TP / (2 TP + 0 FP + 1 unknown)
    expect(m.perDifficulty).toEqual({
      easy: { found: 1, total: 1 },
      medium: { found: 1, total: 1 },
      hard: { found: 0, total: 1 },
    });
  });

  it("handles zero confirmed findings (precision 1, recall 0)", () => {
    const c = classifyFindings([], manifest);
    const m = computeMetrics(c, manifest);
    expect(m.recall).toBe(0);
    expect(m.precision).toBe(1);
  });
});
