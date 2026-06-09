import { writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  InventoryResult,
  CandidateFinding,
  Finding,
  renderReport,
  toSarif,
  sortFindings,
  type TFinding,
  type TInventoryResult,
  type SarifLog,
} from "@authzscan/shared";
import { runInventory } from "@authzscan/inventory";
import { ArtifactStore } from "./artifacts.js";
import { BudgetGuard, type TokenUsage } from "./usage.js";
import { runTracePhase } from "./trace.js";
import { runVerifyPhase } from "./verify.js";
import type { AgentRunner, RetryOptions } from "./runner.js";

const CandidatesArtifact = z.object({ candidates: z.array(CandidateFinding), unscannedEndpointIds: z.array(z.string()) });
const FindingsArtifact = z.object({ findings: z.array(Finding), unscannedEndpointIds: z.array(z.string()) });

export interface ScanOptions {
  repoPath: string;
  runner: AgentRunner;
  model: string;
  retry: RetryOptions;
  budgetUsd?: number;
  maxEndpoints?: number;
  resume?: boolean;
  log?: (message: string) => void;
}

export interface ScanResult {
  findings: TFinding[];
  coverage: { analyzed: number; total: number; unscanned: string[] };
  reportMarkdown: string;
  sarif: SarifLog;
  spentUsd: number;
  totalUsage: TokenUsage;
}

export async function executeScan(opts: ScanOptions): Promise<ScanResult> {
  const store = new ArtifactStore(opts.repoPath);
  const guard = new BudgetGuard(opts.budgetUsd, opts.model);

  // Phase 1: inventory (deterministic; cheap to redo, but resume keeps it byte-stable)
  let inventory: TInventoryResult | null = opts.resume ? store.read("inventory", InventoryResult) : null;
  if (!inventory) {
    inventory = runInventory(opts.repoPath);
    store.write("inventory", inventory);
  }
  let endpoints = inventory.endpoints;
  if (opts.maxEndpoints !== undefined) endpoints = endpoints.slice(0, opts.maxEndpoints);
  opts.log?.(`inventory: ${endpoints.length} endpoint(s), auth library ${inventory.authProfile.library}`);

  // Phase 2: trace
  let traceData = opts.resume ? store.read("candidates", CandidatesArtifact) : null;
  if (!traceData) {
    const trace = await runTracePhase({
      endpoints,
      authProfile: inventory.authProfile,
      repoRoot: opts.repoPath,
      runner: opts.runner,
      guard,
      retry: opts.retry,
      log: opts.log,
    });
    traceData = { candidates: trace.candidates, unscannedEndpointIds: trace.unscannedEndpointIds };
    store.write("candidates", traceData);
  }

  // Phase 3: verify
  let verifyData = opts.resume ? store.read("findings", FindingsArtifact) : null;
  if (!verifyData) {
    const verify = await runVerifyPhase({
      candidates: traceData.candidates,
      authProfile: inventory.authProfile,
      repoRoot: opts.repoPath,
      runner: opts.runner,
      guard,
      retry: opts.retry,
      log: opts.log,
    });
    verifyData = { findings: verify.findings, unscannedEndpointIds: traceData.unscannedEndpointIds };
    store.write("findings", verifyData);
  }

  // Phase 4: render
  const findings = sortFindings(verifyData.findings);
  const unscanned = verifyData.unscannedEndpointIds;
  const coverage = {
    analyzed: endpoints.length - unscanned.length,
    total: endpoints.length,
    unscanned,
  };
  const reportMarkdown = renderReport({
    repoPath: opts.repoPath,
    generatedAt: new Date().toISOString(),
    coverage,
    findings,
  });
  const sarif = toSarif(findings, { toolVersion: "0.1.0" });

  const outDir = path.dirname(store.path("inventory"));
  writeFileSync(path.join(outDir, "report.md"), reportMarkdown, "utf8");
  writeFileSync(path.join(outDir, "results.sarif"), JSON.stringify(sarif, null, 2), "utf8");

  return { findings, coverage, reportMarkdown, sarif, spentUsd: guard.spentUsd(), totalUsage: guard.total() };
}
