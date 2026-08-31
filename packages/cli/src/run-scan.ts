import { executeScan, AnthropicRunner, type ScanResult } from "@authzscan/engine";
import type { TConfidence, TFinding } from "@authzscan/shared";
import { applyBaseline, readBaseline, writeBaseline } from "./baseline.js";
import { EXIT, blockingFindings, exitCodeForScan, type ExitCode } from "./exit-code.js";
import type { ScanOptions } from "./program.js";

export interface ScanSummaryInput {
  findings: TFinding[];
  coverage: { analyzed: number; total: number; unscanned: string[] };
  spentUsd: number;
  suppressed?: number;
  failOn?: TConfidence;
  since?: string;
}

export interface ScanSummary {
  text: string;
  exitCode: ExitCode;
}

export function buildScanSummary(input: ScanSummaryInput): ScanSummary {
  const failOn = input.failOn ?? "low";
  const confirmed = input.findings.filter((f) => f.verdict === "confirmed");
  const blocking = blockingFindings(input.findings, failOn);
  const lines = [`authzscan: ${input.coverage.analyzed}/${input.coverage.total} endpoints analyzed`];
  if (input.since !== undefined) {
    lines.push(`Scope: files changed since ${input.since}. Endpoints outside that diff were NOT reviewed.`);
  }
  const missed = input.coverage.total - input.coverage.analyzed;
  if (missed > 0) {
    lines.push(`WARNING: ${missed} endpoint(s) NOT analyzed — this is not a clean bill for them.`);
  }
  lines.push(
    confirmed.length === 0
      ? "No confirmed findings."
      : `${confirmed.length} confirmed finding${confirmed.length === 1 ? "" : "s"}.`,
  );
  if (failOn !== "low" && confirmed.length > blocking.length) {
    lines.push(`${confirmed.length - blocking.length} below --fail-on ${failOn}, reported but not failing the build.`);
  }
  if (input.suppressed) {
    lines.push(`${input.suppressed} finding(s) suppressed by baseline.`);
  }
  lines.push(`Estimated spend: $${input.spentUsd.toFixed(2)}`);
  lines.push("Report: .authzscan/report.md  SARIF: .authzscan/results.sarif");
  return { text: lines.join("\n"), exitCode: exitCodeForScan(input.findings, input.coverage, failOn) };
}

export async function runScanCommand(repo: string, opts: ScanOptions): Promise<never> {
  if (opts.updateBaseline && opts.baseline === undefined) {
    console.error("authzscan: --update-baseline needs --baseline <file> to say which file to write.");
    process.exit(EXIT.ERROR);
  }

  // Read the baseline before spending anything: a typo in the path should not
  // cost a full scan to discover.
  let accepted = new Set<string>();
  if (opts.baseline !== undefined && !opts.updateBaseline) {
    try {
      accepted = readBaseline(opts.baseline);
    } catch (err) {
      console.error(`authzscan: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(EXIT.ERROR);
    }
  }

  let result: ScanResult;
  try {
    result = await executeScan({
      repoPath: repo,
      runner: new AnthropicRunner({ model: opts.model }),
      model: opts.model,
      retry: { retries: 2, delayMs: 1000 },
      budgetUsd: opts.budget,
      maxEndpoints: opts.maxEndpoints,
      sinceRef: opts.since,
      resume: opts.resume,
      log: (m) => console.error(`[authzscan] ${m}`),
    });
  } catch (err) {
    console.error(`authzscan: scan failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.ERROR);
  }

  if (opts.format === "json") {
    console.log(JSON.stringify({ findings: result.findings, coverage: result.coverage }, null, 2));
  } else if (opts.format === "sarif") {
    console.log(JSON.stringify(result.sarif, null, 2));
  } else {
    console.log(result.reportMarkdown);
  }

  if (opts.updateBaseline && opts.baseline !== undefined) {
    const n = writeBaseline(opts.baseline, result.findings);
    console.error(`authzscan: wrote ${n} accepted endpoint(s) to ${opts.baseline}. Review it before committing.`);
    process.exit(EXIT.CLEAN);
  }

  // ponytail: the baseline splits the summary and the exit code only. report.md
  // still lists suppressed findings as confirmed, which is honest; move the
  // split into renderReport if that stops reading clearly.
  const { active, suppressed } = applyBaseline(result.findings, accepted);
  const summary = buildScanSummary({
    findings: active,
    coverage: result.coverage,
    spentUsd: result.spentUsd,
    suppressed: suppressed.filter((f) => f.verdict === "confirmed").length,
    failOn: opts.failOn,
    since: opts.since,
  });
  console.error(summary.text);
  process.exit(summary.exitCode);
}
