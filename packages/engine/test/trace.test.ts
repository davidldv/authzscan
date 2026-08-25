import { describe, it, expect } from "vitest";
import { runTracePhase, BudgetGuard } from "../src/index.js";
import type { AgentRunner } from "../src/index.js";
import type { TEndpoint, TAuthProfile } from "@authzscan/shared";

const profile: TAuthProfile = { library: "custom", sessionAccessPatterns: [], ownershipIdioms: [] };

function ep(id: string, key: string): TEndpoint {
  return {
    id,
    kind: "route-handler",
    file: `app${key}/route.ts`,
    method: "GET",
    routePath: key,
    params: ["id"],
    usesDb: true,
    authIndicators: [],
  };
}

const usage = { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 };

function candidateJson(id: string, endpointId: string): string {
  return JSON.stringify([
    {
      id,
      endpointId,
      title: "t",
      description: "d",
      evidence: [{ file: "app/x/route.ts", startLine: 1, endLine: 2, note: "n" }],
    },
  ]);
}

describe("runTracePhase", () => {
  it("collects validated candidates across groups", async () => {
    const runner: AgentRunner = {
      run: async ({ prompt }) => ({
        text: prompt.includes('"/api/a"') ? candidateJson("c1", "a1") : "[]",
        usage,
      }),
    };
    const result = await runTracePhase({
      endpoints: [ep("a1", "/api/a"), ep("b1", "/api/b")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.candidates.map((c) => c.id)).toEqual(["c1"]);
    expect(result.unscannedEndpointIds).toEqual([]);
  });

  it("re-prompts once on invalid output, then succeeds", async () => {
    let calls = 0;
    const runner: AgentRunner = {
      run: async () => {
        calls++;
        return { text: calls === 1 ? "garbage, no json" : candidateJson("c1", "a1"), usage };
      },
    };
    const result = await runTracePhase({
      endpoints: [ep("a1", "/api/a")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(calls).toBe(2);
    expect(result.candidates.map((c) => c.id)).toEqual(["c1"]);
  });

  it("marks group endpoints unscanned after persistent failure, scan continues", async () => {
    const runner: AgentRunner = {
      run: async ({ prompt }) => {
        if (prompt.includes('"/api/a"')) throw new Error("api down");
        return { text: candidateJson("c2", "b1"), usage };
      },
    };
    const result = await runTracePhase({
      endpoints: [ep("a1", "/api/a"), ep("b1", "/api/b")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 1, delayMs: 0 },
    });
    expect(result.unscannedEndpointIds).toEqual(["a1"]);
    expect(result.candidates.map((c) => c.id)).toEqual(["c2"]);
  });

  it("halts at budget cap, marking remaining groups unscanned", async () => {
    const bigUsage = { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0 }; // $5 on fable
    const runner: AgentRunner = { run: async () => ({ text: "[]", usage: bigUsage }) };
    const result = await runTracePhase({
      endpoints: [ep("a1", "/api/a"), ep("b1", "/api/b"), ep("c1", "/api/c")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(4, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    // First group spends $5 >= $4 budget → remaining two groups never run.
    expect(result.unscannedEndpointIds).toEqual(["b1", "c1"]);
    expect(result.budgetExceeded).toBe(true);
  });

  it("stops calling the model once several groups fail in a row", async () => {
    let calls = 0;
    const runner: AgentRunner = {
      run: async () => {
        calls += 1;
        throw new Error("Could not resolve authentication method");
      },
    };
    const keys = ["/api/a", "/api/b", "/api/c", "/api/d", "/api/e", "/api/f"];
    const result = await runTracePhase({
      endpoints: keys.map((k, i) => ep(`e${i}`, k)),
      authProfile: profile,
      repoRoot: "/tmp",
      runner,
      guard: new BudgetGuard(undefined, "claude-sonnet-4-6"),
      retry: { retries: 0, delayMs: 0 },
    });

    // Three failing groups trip the breaker; the remaining three are never attempted.
    expect(calls).toBe(3);
    // Every endpoint is still accounted for as unanalyzed, none silently dropped.
    expect(result.unscannedEndpointIds).toHaveLength(keys.length);
    expect(result.budgetExceeded).toBe(false);
  });
});
