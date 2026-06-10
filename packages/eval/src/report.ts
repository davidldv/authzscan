import { aggregateRuns, type RunOutcome } from "./aggregate.js";

export interface EvalReportInput {
  model: string;
  generatedAt: string;
  runs: RunOutcome[];
  gates: { recall: number; precision: number };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function renderEvalReport(input: EvalReportInput): string {
  const agg = aggregateRuns(input.runs);
  const recallPass = agg.recall.mean >= input.gates.recall;
  const precisionPass = agg.precision.mean >= input.gates.precision;

  const lines: string[] = [
    "# authzscan eval report",
    "",
    `- **Model:** ${input.model}`,
    `- **Generated:** ${input.generatedAt}`,
    `- **Runs:** ${input.runs.length}`,
    "",
    "## Aggregate",
    "",
    `- Recall: ${pct(agg.recall.mean)} (±${pct(agg.recall.stddev)})`,
    `- Precision: ${pct(agg.precision.mean)} (±${pct(agg.precision.stddev)})`,
    `- Cost per scan: $${agg.costUsd.mean.toFixed(2)} (±$${agg.costUsd.stddev.toFixed(2)})`,
    `- Duration per scan: ${(agg.durationMs.mean / 1000).toFixed(0)}s`,
    "",
    "## Gates",
    "",
    `- recall gate (>=${pct(input.gates.recall).replace(".0%", "%")}): ${recallPass ? "PASS" : "FAIL"}`,
    `- precision gate (>=${pct(input.gates.precision).replace(".0%", "%")}): ${precisionPass ? "PASS" : "FAIL"}`,
    "",
    "## Per run",
    "",
    "| run | recall | precision | TP | FP | unknown | matched vulns | cost |",
    "|---|---|---|---|---|---|---|---|",
  ];

  input.runs.forEach((r, i) => {
    const d = r.metrics.perDifficulty;
    lines.push(
      `| ${i + 1} | ${pct(r.metrics.recall)} | ${pct(r.metrics.precision)} | ${r.classification.truePositives.length} | ${r.classification.falsePositives.length} | ${r.classification.unknowns.length} | ${r.classification.matchedVulnIds.join(" ") || "-"} | $${r.costUsd.toFixed(2)} |`,
    );
    lines.push(
      `| | easy ${d.easy.found}/${d.easy.total} | medium ${d.medium.found}/${d.medium.total} | hard ${d.hard.found}/${d.hard.total} | | | | |`,
    );
  });

  lines.push("");
  return lines.join("\n");
}
