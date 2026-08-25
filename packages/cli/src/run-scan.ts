import { executeScan, AnthropicRunner, type ScanResult } from "@authzscan/engine";
import type { TFinding } from "@authzscan/shared";
import { EXIT, exitCodeForScan, type ExitCode } from "./exit-code.js";
import type { ScanOptions } from "./program.js";

export interface ScanSummaryInput {
  findings: TFinding[];
  coverage: { analyzed: number; total: number; unscanned: string[] };
  spentUsd: number;
}

export interface ScanSummary {
  text: string;
  exitCode: ExitCode;
}

export function buildScanSummary(input: ScanSummaryInput): ScanSummary {
  const confirmed = input.findings.filter((f) => f.verdict === "confirmed");
  const lines = [
    `authzscan: ${input.coverage.analyzed}/${input.coverage.total} endpoints analyzed`,
  ];
  const missed = input.coverage.total - input.coverage.analyzed;
  if (missed > 0) {
    lines.push(`WARNING: ${missed} endpoint(s) NOT analyzed — this is not a clean bill for them.`);
  }
  lines.push(
    confirmed.length === 0
      ? "No confirmed findings."
      : `${confirmed.length} confirmed finding${confirmed.length === 1 ? "" : "s"}.`,
  );
  lines.push(`Estimated spend: $${input.spentUsd.toFixed(2)}`);
  lines.push("Report: .authzscan/report.md  SARIF: .authzscan/results.sarif");
  return { text: lines.join("\n"), exitCode: exitCodeForScan(input.findings, input.coverage) };
}

export async function runScanCommand(repo: string, opts: ScanOptions): Promise<never> {
  let result: ScanResult;
  try {
    result = await executeScan({
      repoPath: repo,
      runner: new AnthropicRunner({ model: opts.model }),
      model: opts.model,
      retry: { retries: 2, delayMs: 1000 },
      budgetUsd: opts.budget,
      maxEndpoints: opts.maxEndpoints,
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

  const summary = buildScanSummary(result);
  console.error(summary.text);
  process.exit(summary.exitCode);
}
