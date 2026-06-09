import { describe, it, expect } from "vitest";
import { renderEvalReport } from "../src/index.js";
import type { RunOutcome } from "../src/index.js";

const outcome: RunOutcome = {
  metrics: {
    recall: 0.875,
    precision: 0.78,
    perDifficulty: { easy: { found: 6, total: 6 }, medium: { found: 5, total: 6 }, hard: { found: 3, total: 4 } },
  },
  classification: { matchedVulnIds: ["V1", "V2"], truePositives: [], falsePositives: [], unknowns: [] },
  costUsd: 2.34,
  durationMs: 90_000,
};

describe("renderEvalReport", () => {
  const md = renderEvalReport({
    model: "claude-fable-5",
    generatedAt: "2026-06-09T12:00:00Z",
    runs: [outcome, outcome],
    gates: { recall: 0.8, precision: 0.7 },
  });

  it("is a stable snapshot", () => {
    expect(md).toMatchSnapshot();
  });

  it("states gate results explicitly", () => {
    expect(md).toContain("recall gate (>=80%): PASS");
    expect(md).toContain("precision gate (>=70%): PASS");
  });

  it("fails gates when below threshold", () => {
    const bad = renderEvalReport({
      model: "claude-fable-5",
      generatedAt: "2026-06-09T12:00:00Z",
      runs: [{ ...outcome, metrics: { ...outcome.metrics, recall: 0.5, precision: 0.5 } }],
      gates: { recall: 0.8, precision: 0.7 },
    });
    expect(bad).toContain("recall gate (>=80%): FAIL");
    expect(bad).toContain("precision gate (>=70%): FAIL");
  });
});
