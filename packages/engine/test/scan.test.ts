import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeScan } from "../src/index.js";
import type { AgentRunner } from "../src/index.js";

const fixtureSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "inventory", "test", "fixtures", "basic-app",
);

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "authzscan-scan-"));
  cpSync(fixtureSrc, repo, { recursive: true });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 };

const traceReply = JSON.stringify([
  {
    id: "f_orders_get",
    endpointId: "ep_app_api_orders_id_route_ts_get",
    title: "Order fetched without ownership check",
    description: "findUnique keyed only on id",
    evidence: [{ file: "app/api/orders/[id]/route.ts", startLine: 6, endLine: 8, note: "no userId" }],
  },
]);
const verifyReply = JSON.stringify({
  verdict: "confirmed",
  confidence: "high",
  reproduction: "user A fetches user B's order id",
  suggestedFix: "scope where clause by session user id",
});

function fakeRunner(): AgentRunner {
  return {
    run: async ({ prompt }) => ({
      text: prompt.includes("adversarially verifying") ? verifyReply : prompt.includes("/api/orders") ? traceReply : "[]",
      usage,
    }),
  };
}

describe("executeScan", () => {
  it("runs end-to-end and reports coverage + findings", async () => {
    const result = await executeScan({
      repoPath: repo,
      runner: fakeRunner(),
      model: "claude-fable-5",
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.findings.map((f) => f.verdict)).toEqual(["confirmed"]);
    expect(result.coverage.total).toBe(4);
    expect(result.coverage.analyzed).toBe(4);
    expect(result.reportMarkdown).toContain("Order fetched without ownership check");
    expect(result.sarif.runs[0].results).toHaveLength(1);
  });

  it("writes resumable artifacts to .authzscan/", async () => {
    await executeScan({ repoPath: repo, runner: fakeRunner(), model: "claude-fable-5", retry: { retries: 0, delayMs: 0 } });
    for (const name of ["inventory.json", "candidates.json", "findings.json"]) {
      expect(existsSync(path.join(repo, ".authzscan", name))).toBe(true);
    }
  });

  it("resume skips completed phases (runner never called)", async () => {
    await executeScan({ repoPath: repo, runner: fakeRunner(), model: "claude-fable-5", retry: { retries: 0, delayMs: 0 } });
    let calls = 0;
    const countingRunner: AgentRunner = {
      run: async () => {
        calls++;
        return { text: "[]", usage };
      },
    };
    const result = await executeScan({
      repoPath: repo,
      runner: countingRunner,
      model: "claude-fable-5",
      retry: { retries: 0, delayMs: 0 },
      resume: true,
    });
    expect(calls).toBe(0);
    expect(result.findings).toHaveLength(1);
  });

  it("writes report.md and results.sarif into .authzscan/", async () => {
    await executeScan({ repoPath: repo, runner: fakeRunner(), model: "claude-fable-5", retry: { retries: 0, delayMs: 0 } });
    const report = readFileSync(path.join(repo, ".authzscan", "report.md"), "utf8");
    expect(report).toContain("# authzscan report");
    const sarif = JSON.parse(readFileSync(path.join(repo, ".authzscan", "results.sarif"), "utf8"));
    expect(sarif.version).toBe("2.1.0");
  });

  it("does not treat a budget-starved verify pass as a finished one", async () => {
    // Budget runs out during trace, so no candidate gets an adversarial pass.
    const starved = await executeScan({
      repoPath: repo,
      runner: fakeRunner(),
      model: "claude-fable-5",
      retry: { retries: 0, delayMs: 0 },
      budgetUsd: 0.0000001,
    });
    expect(starved.findings.some((f) => f.reproduction.startsWith("UNVERIFIED"))).toBe(true);

    const findingsArtifact = JSON.parse(
      readFileSync(path.join(repo, ".authzscan", "findings.json"), "utf8"),
    ) as { complete: boolean };
    expect(findingsArtifact.complete).toBe(false);

    // Resuming must re-run the phase that gave up, not adopt its output.
    let verifyCalls = 0;
    const counting: AgentRunner = {
      run: async (req) => {
        if (req.prompt.includes("adversarially verifying")) verifyCalls += 1;
        return fakeRunner().run(req);
      },
    };
    const resumed = await executeScan({
      repoPath: repo,
      runner: counting,
      model: "claude-fable-5",
      retry: { retries: 0, delayMs: 0 },
      resume: true,
    });

    expect(verifyCalls).toBeGreaterThan(0);
    expect(resumed.findings.every((f) => !f.reproduction.startsWith("UNVERIFIED"))).toBe(true);
  });
});
