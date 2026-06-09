import { describe, it, expect } from "vitest";
import { emptyUsage, addUsage, estimateUsd, BudgetGuard } from "../src/index.js";

describe("usage accounting", () => {
  it("adds usage immutably", () => {
    const a = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 };
    const sum = addUsage(emptyUsage(), a);
    expect(sum).toEqual(a);
    expect(addUsage(sum, a)).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
    });
  });

  it("estimates USD for claude-fable-5 ($10 in / $50 out per MTok, cache 0.1x/1.25x)", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    };
    // 10 + 50 + 1 (0.1*10) + 12.5 (1.25*10) = 73.5
    expect(estimateUsd(usage, "claude-fable-5")).toBeCloseTo(73.5, 5);
  });

  it("falls back to fable pricing for unknown models (conservative)", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    expect(estimateUsd(usage, "some-future-model")).toBeCloseTo(10, 5);
  });
});

describe("BudgetGuard", () => {
  it("is never exceeded without a budget", () => {
    const guard = new BudgetGuard(undefined, "claude-fable-5");
    guard.record({ inputTokens: 9_999_999, outputTokens: 9_999_999, cacheReadTokens: 0, cacheCreationTokens: 0 });
    expect(guard.exceeded()).toBe(false);
  });

  it("trips once estimated spend reaches the budget", () => {
    const guard = new BudgetGuard(0.5, "claude-fable-5");
    expect(guard.exceeded()).toBe(false);
    guard.record({ inputTokens: 0, outputTokens: 10_000, cacheReadTokens: 0, cacheCreationTokens: 0 }); // $0.50
    expect(guard.exceeded()).toBe(true);
    expect(guard.spentUsd()).toBeCloseTo(0.5, 5);
  });
});
