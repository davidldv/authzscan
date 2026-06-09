import { sortFindings, type TFinding } from "./finding.js";

export interface ReportInput {
  repoPath: string;
  generatedAt: string;
  coverage: { analyzed: number; total: number; unscanned: string[] };
  findings: TFinding[];
}

export function renderReport(input: ReportInput): string {
  const confirmed = sortFindings(input.findings.filter((f) => f.verdict === "confirmed"));
  const { analyzed, total, unscanned } = input.coverage;

  const lines: string[] = [
    "# authzscan report",
    "",
    `- **Repo:** ${input.repoPath}`,
    `- **Generated:** ${input.generatedAt}`,
    `- **Coverage:** ${analyzed}/${total} endpoints analyzed, ${unscanned.length} not scanned`,
    `- **Result:** ${
      confirmed.length === 0
        ? "No confirmed findings"
        : `${confirmed.length} confirmed finding${confirmed.length === 1 ? "" : "s"}`
    }`,
    "",
  ];

  if (unscanned.length > 0) {
    lines.push("## Unscanned endpoints", "");
    lines.push("These endpoints were NOT analyzed. Do not treat this report as a clean bill for them.", "");
    for (const id of unscanned) lines.push(`- \`${id}\``);
    lines.push("");
  }

  for (const f of confirmed) {
    lines.push(`## [${f.confidence.toUpperCase()}] ${f.title}`, "");
    lines.push(f.description, "");
    lines.push("**Evidence:**", "");
    for (const e of f.evidence) {
      lines.push(`- \`${e.file}:${e.startLine}-${e.endLine}\` — ${e.note}`);
    }
    lines.push("", "**Reproduction:**", "", f.reproduction, "");
    lines.push("**Suggested fix:**", "", f.suggestedFix, "");
  }

  return lines.join("\n");
}
