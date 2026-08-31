import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { TFinding } from "@authzscan/shared";

// Keyed on endpointId, not on the finding text: the endpoint id is derived
// deterministically from file path + export name, while a finding's title and
// line numbers are model output and drift between runs. A baseline that stops
// matching after a re-run is worse than no baseline.
export const Baseline = z.object({
  version: z.literal(1),
  accepted: z.array(
    z.object({
      endpointId: z.string().min(1),
      title: z.string().default(""),
      reason: z.string().default(""),
    }),
  ),
});
export type TBaseline = z.infer<typeof Baseline>;

/** Throws on a missing or malformed file: a baseline that fails open suppresses nothing and tells nobody. */
export function readBaseline(file: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`--baseline ${file}: file not found. Create it with --baseline ${file} --update-baseline.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`--baseline ${file}: not valid JSON.`);
  }
  const parsed = Baseline.safeParse(json);
  if (!parsed.success) {
    throw new Error(`--baseline ${file}: not a valid baseline file (${parsed.error.issues[0]?.message ?? "unknown"}).`);
  }
  return new Set(parsed.data.accepted.map((a) => a.endpointId));
}

/** Records one entry per endpoint that currently has a confirmed finding. Returns the entry count. */
export function writeBaseline(file: string, findings: TFinding[]): number {
  const byEndpoint = new Map<string, string>();
  for (const f of findings) {
    if (f.verdict === "confirmed" && !byEndpoint.has(f.endpointId)) byEndpoint.set(f.endpointId, f.title);
  }
  const accepted = [...byEndpoint]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([endpointId, title]) => ({ endpointId, title, reason: "" }));
  writeFileSync(file, `${JSON.stringify({ version: 1, accepted }, null, 2)}\n`, "utf8");
  return accepted.length;
}

export interface Partitioned {
  active: TFinding[];
  suppressed: TFinding[];
}

export function applyBaseline(findings: TFinding[], accepted: Set<string>): Partitioned {
  const active: TFinding[] = [];
  const suppressed: TFinding[] = [];
  for (const f of findings) (accepted.has(f.endpointId) ? suppressed : active).push(f);
  return { active, suppressed };
}
