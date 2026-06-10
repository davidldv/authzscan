import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeScan, type AgentRunner } from "@authzscan/engine";
import { loadManifest } from "./manifest.js";
import { classifyFindings, computeMetrics } from "./classify.js";
import { aggregateRuns, type RunOutcome } from "./aggregate.js";
import { renderEvalReport } from "./report.js";

export const GATES = { recall: 0.8, precision: 0.7 };

export interface RunEvalOptions {
  benchmarkDir: string;
  runner: AgentRunner;
  model: string;
  runs: number;
  budgetUsd?: number;
  log?: (message: string) => void;
}

export interface RunEvalResult {
  outcomes: RunOutcome[];
  report: string;
  gatesPassed: boolean;
}

const COPY_EXCLUDE = new Set(["vulns.json", "node_modules", ".authzscan"]);

export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult> {
  const manifest = loadManifest(opts.benchmarkDir);

  // Scan a copy WITHOUT vulns.json: the answer key must never be readable by
  // the agent under test, even via a guessed read_file path.
  const scanDir = mkdtempSync(path.join(tmpdir(), "authzscan-eval-"));
  try {
    cpSync(opts.benchmarkDir, scanDir, {
      recursive: true,
      filter: (src) => !COPY_EXCLUDE.has(path.basename(src)),
    });

    const outcomes: RunOutcome[] = [];
    for (let i = 0; i < opts.runs; i++) {
      opts.log?.(`eval run ${i + 1}/${opts.runs}`);
      rmSync(path.join(scanDir, ".authzscan"), { recursive: true, force: true });
      const startedAt = Date.now();
      const scan = await executeScan({
        repoPath: scanDir,
        runner: opts.runner,
        model: opts.model,
        retry: { retries: 2, delayMs: 1000 },
        budgetUsd: opts.budgetUsd,
        log: opts.log,
      });
      const classification = classifyFindings(scan.findings, manifest);
      const metrics = computeMetrics(classification, manifest);
      outcomes.push({
        metrics,
        classification,
        costUsd: scan.spentUsd,
        durationMs: Date.now() - startedAt,
      });
      opts.log?.(
        `run ${i + 1}: recall ${(metrics.recall * 100).toFixed(1)}%, precision ${(metrics.precision * 100).toFixed(1)}%, cost $${scan.spentUsd.toFixed(2)}`,
      );
    }

    const report = renderEvalReport({
      model: opts.model,
      generatedAt: new Date().toISOString(),
      runs: outcomes,
      gates: GATES,
    });
    const agg = aggregateRuns(outcomes);
    const gatesPassed = agg.recall.mean >= GATES.recall && agg.precision.mean >= GATES.precision;
    return { outcomes, report, gatesPassed };
  } finally {
    rmSync(scanDir, { recursive: true, force: true });
  }
}
