import { describe, it, expect } from "vitest";
import { runVerifyPhase, BudgetGuard } from "../src/index.js";
import type { AgentRunner } from "../src/index.js";
import type { TCandidateFinding, TAuthProfile } from "@authzscan/shared";

const profile: TAuthProfile = { library: "custom", sessionAccessPatterns: [], ownershipIdioms: [] };
const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 };

function candidate(id: string): TCandidateFinding {
  return {
    id,
    endpointId: "ep1",
    title: "t",
    description: "d",
    evidence: [{ file: "a.ts", startLine: 1, endLine: 2, note: "n" }],
  };
}

const verdictJson = (verdict: string, confidence = "high") =>
  JSON.stringify({ verdict, confidence, reproduction: "repro", suggestedFix: "fix" });

describe("runVerifyPhase", () => {
  it("merges verdicts onto candidates", async () => {
    const runner: AgentRunner = {
      run: async ({ prompt }) => ({
        text: prompt.includes('"c1"') ? verdictJson("confirmed") : verdictJson("rejected", "low"),
        usage,
      }),
    };
    const result = await runVerifyPhase({
      candidates: [candidate("c1"), candidate("c2")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.findings.map((f) => [f.id, f.verdict])).toEqual([
      ["c1", "confirmed"],
      ["c2", "rejected"],
    ]);
  });

  it("degrades loudly on verify failure: kept as low-confidence confirmed with explicit note", async () => {
    const runner: AgentRunner = {
      run: async () => {
        throw new Error("api down");
      },
    };
    const result = await runVerifyPhase({
      candidates: [candidate("c1")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].verdict).toBe("confirmed");
    expect(result.findings[0].confidence).toBe("low");
    expect(result.findings[0].reproduction).toMatch(/verification failed/i);
  });

  it("stops verifying at budget cap; remaining candidates marked unverified", async () => {
    const bigUsage = { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const runner: AgentRunner = { run: async () => ({ text: verdictJson("confirmed"), usage: bigUsage }) };
    const result = await runVerifyPhase({
      candidates: [candidate("c1"), candidate("c2")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(4, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.findings[0].verdict).toBe("confirmed");
    expect(result.findings[1].confidence).toBe("low");
    expect(result.findings[1].reproduction).toMatch(/budget/i);
  });
});
