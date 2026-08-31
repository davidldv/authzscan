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
import { VERSION } from "@authzscan/shared";
import { ArtifactStore } from "./artifacts.js";
import { BudgetGuard, type TokenUsage } from "./usage.js";
import { changedFiles } from "./changed.js";
import { runTracePhase } from "./trace.js";
import { runVerifyPhase } from "./verify.js";
import type { AgentRunner, RetryOptions } from "./runner.js";

// `complete` distinguishes a phase that finished from one that gave up. Artifacts
// written before this field existed default to false, so they are re-run rather
// than trusted.
const CandidatesArtifact = z.object({
  candidates: z.array(CandidateFinding),
  unscannedEndpointIds: z.array(z.string()),
  complete: z.boolean().default(false),
});
const FindingsArtifact = z.object({
  findings: z.array(Finding),
  unscannedEndpointIds: z.array(z.string()),
  complete: z.boolean().default(false),
});

export interface ScanOptions {
  repoPath: string;
  runner: AgentRunner;
  model: string;
  retry: RetryOptions;
  budgetUsd?: number;
  maxEndpoints?: number;
  /** git ref; scan only endpoints in files that differ from it. */
  sinceRef?: string;
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
  opts.log?.(`inventory: ${endpoints.length} endpoint(s), auth library ${inventory.authProfile.library}`);
  if (opts.sinceRef !== undefined) {
    const touched = changedFiles(opts.repoPath, opts.sinceRef);
    endpoints = endpoints.filter((e) => touched.has(e.file));
    opts.log?.(`--since ${opts.sinceRef}: ${endpoints.length} endpoint(s) in changed files`);
  }
  if (opts.maxEndpoints !== undefined) endpoints = endpoints.slice(0, opts.maxEndpoints);

  // Phase 2: trace. A partial run resumes on the endpoints it never reached
  // instead of re-paying for the groups it already traced.
  const storedTrace = opts.resume ? store.read("candidates", CandidatesArtifact) : null;
  let traceData = storedTrace?.complete === true ? storedTrace : null;
  if (!traceData) {
    const pendingIds = storedTrace ? new Set(storedTrace.unscannedEndpointIds) : null;
    const pending = pendingIds ? endpoints.filter((e) => pendingIds.has(e.id)) : endpoints;
    if (storedTrace) opts.log?.(`resuming trace: ${pending.length} endpoint(s) not analyzed last run`);
    const trace = await runTracePhase({
      endpoints: pending,
      authProfile: inventory.authProfile,
      repoRoot: opts.repoPath,
      runner: opts.runner,
      guard,
      retry: opts.retry,
      log: opts.log,
    });
    traceData = {
      candidates: [...(storedTrace?.candidates ?? []), ...trace.candidates],
      unscannedEndpointIds: trace.unscannedEndpointIds,
      complete: trace.unscannedEndpointIds.length === 0,
    };
    store.write("candidates", traceData);
  }

  // Phase 3: verify.
  // ponytail: re-verifies every candidate when the last pass was incomplete.
  // Verify prompts are single-candidate and cheap next to trace; switch to
  // re-verifying only unverifiedCandidateIds if that stops being true.
  const storedVerify = opts.resume ? store.read("findings", FindingsArtifact) : null;
  let verifyData = storedVerify?.complete === true ? storedVerify : null;
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
    if (verify.unverifiedCandidateIds.length > 0) {
      opts.log?.(`${verify.unverifiedCandidateIds.length} candidate(s) reported WITHOUT an adversarial pass`);
    }
    verifyData = {
      findings: verify.findings,
      unscannedEndpointIds: traceData.unscannedEndpointIds,
      complete: verify.unverifiedCandidateIds.length === 0,
    };
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
  const sarif = toSarif(findings, { toolVersion: VERSION });

  const outDir = path.dirname(store.path("inventory"));
  writeFileSync(path.join(outDir, "report.md"), reportMarkdown, "utf8");
  writeFileSync(path.join(outDir, "results.sarif"), JSON.stringify(sarif, null, 2), "utf8");

  return { findings, coverage, reportMarkdown, sarif, spentUsd: guard.spentUsd(), totalUsage: guard.total() };
}
