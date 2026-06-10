import { describe, it, expect } from "vitest";
import { aggregateRuns } from "../src/index.js";
import type { RunOutcome } from "../src/index.js";

function run(recall: number, precision: number, costUsd: number): RunOutcome {
  return {
    metrics: {
      recall,
      precision,
      perDifficulty: { easy: { found: 0, total: 0 }, medium: { found: 0, total: 0 }, hard: { found: 0, total: 0 } },
    },
    classification: { matchedVulnIds: [], truePositives: [], falsePositives: [], unknowns: [] },
    costUsd,
    durationMs: 1000,
  };
}

describe("aggregateRuns", () => {
  it("computes mean and sample stddev across runs", () => {
    const agg = aggregateRuns([run(0.8, 0.7, 1), run(0.9, 0.8, 3), run(1.0, 0.9, 2)]);
    expect(agg.recall.mean).toBeCloseTo(0.9, 5);
    expect(agg.recall.stddev).toBeCloseTo(0.1, 5);
    expect(agg.precision.mean).toBeCloseTo(0.8, 5);
    expect(agg.costUsd.mean).toBeCloseTo(2, 5);
  });

  it("stddev is 0 for a single run", () => {
    const agg = aggregateRuns([run(0.8, 0.7, 1)]);
    expect(agg.recall.stddev).toBe(0);
  });
});
