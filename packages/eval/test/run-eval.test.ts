import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRequest, AgentRunResult } from "@authzscan/engine";
import { runEval, PerfectRunner, GATES, loadManifest } from "../src/index.js";
import type { RunEvalResult } from "../src/index.js";

const benchmarkDir = path.resolve(fileURLToPath(import.meta.url), "../../../../benchmark");

describe("runEval with PerfectRunner (sanity gate)", () => {
  const manifest = loadManifest(benchmarkDir);
  const scanRoots: string[] = [];
  let result: RunEvalResult;

  beforeAll(async () => {
    const perfect = new PerfectRunner(manifest);
    const spying = {
      run(request: AgentRunRequest): Promise<AgentRunResult> {
        scanRoots.push(request.repoRoot);
        return perfect.run(request);
      },
    };
    result = await runEval({
      benchmarkDir,
      runner: spying,
      model: "claude-fable-5",
      runs: 2,
    });
  }, 120_000);

  it("scores perfect recall and precision on every run", () => {
    expect(result.outcomes).toHaveLength(2);
    for (const outcome of result.outcomes) {
      expect(outcome.metrics.recall).toBe(1);
      expect(outcome.metrics.precision).toBe(1);
    }
  });

  it("passes both gates and says so in the report", () => {
    expect(result.gatesPassed).toBe(true);
    expect(result.report).toContain("recall gate (>=80%): PASS");
    expect(result.report).toContain("precision gate (>=70%): PASS");
  });

  it("scans a temp copy without the vulns.json answer key", () => {
    expect(scanRoots.length).toBeGreaterThan(0);
    for (const root of new Set(scanRoots)) {
      expect(path.resolve(root)).not.toBe(path.resolve(benchmarkDir));
      expect(existsSync(path.join(root, "vulns.json"))).toBe(false);
    }
  });

  it("exposes the gate thresholds from the plan", () => {
    expect(GATES).toEqual({ recall: 0.8, precision: 0.7 });
  });
});
