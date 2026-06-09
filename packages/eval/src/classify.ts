import type { TFinding } from "@authzscan/shared";
import type { TManifest } from "./manifest.js";

export interface Classification {
  matchedVulnIds: string[];
  truePositives: TFinding[];
  falsePositives: TFinding[];
  unknowns: TFinding[];
}

export function classifyFindings(findings: TFinding[], manifest: TManifest): Classification {
  const vulnByFile = new Map(manifest.vulns.map((v) => [v.file, v]));
  const clean = new Set(manifest.cleanFiles);
  const matched = new Set<string>();
  const truePositives: TFinding[] = [];
  const falsePositives: TFinding[] = [];
  const unknowns: TFinding[] = [];

  for (const f of findings) {
    if (f.verdict !== "confirmed") continue;
    const files = f.evidence.map((e) => e.file);
    const vuln = files.map((file) => vulnByFile.get(file)).find((v) => v !== undefined);
    if (vuln) {
      matched.add(vuln.id);
      truePositives.push(f);
    } else if (files.some((file) => clean.has(file))) {
      falsePositives.push(f);
    } else {
      unknowns.push(f);
    }
  }

  const order = manifest.vulns.map((v) => v.id);
  return {
    matchedVulnIds: order.filter((id) => matched.has(id)),
    truePositives,
    falsePositives,
    unknowns,
  };
}

export interface Metrics {
  recall: number;
  precision: number;
  perDifficulty: Record<"easy" | "medium" | "hard", { found: number; total: number }>;
}

export function computeMetrics(c: Classification, manifest: TManifest): Metrics {
  const matched = new Set(c.matchedVulnIds);
  const perDifficulty = { easy: { found: 0, total: 0 }, medium: { found: 0, total: 0 }, hard: { found: 0, total: 0 } };
  for (const v of manifest.vulns) {
    perDifficulty[v.difficulty].total++;
    if (matched.has(v.id)) perDifficulty[v.difficulty].found++;
  }
  const recall = manifest.vulns.length === 0 ? 1 : matched.size / manifest.vulns.length;
  // Controlled benchmark: anything that isn't a seeded vuln is a wrong finding,
  // so unknowns count against precision alongside clean-file hits.
  const denominator = c.truePositives.length + c.falsePositives.length + c.unknowns.length;
  const precision = denominator === 0 ? 1 : c.truePositives.length / denominator;
  return { recall, precision, perDifficulty };
}
