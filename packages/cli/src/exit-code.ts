import type { TConfidence, TFinding } from "@authzscan/shared";

export const EXIT = { CLEAN: 0, FINDINGS: 1, ERROR: 2 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface Coverage {
  analyzed: number;
  total: number;
  unscanned: string[];
}

const confidenceRank: Record<TConfidence, number> = { high: 3, medium: 2, low: 1 };

/** Confirmed findings at or above the `failOn` confidence. Verdict alone is not the build gate. */
export function blockingFindings(findings: TFinding[], failOn: TConfidence = "low"): TFinding[] {
  return findings.filter((f) => f.verdict === "confirmed" && confidenceRank[f.confidence] >= confidenceRank[failOn]);
}

export function exitCodeForScan(findings: TFinding[], coverage: Coverage, failOn: TConfidence = "low"): ExitCode {
  if (blockingFindings(findings, failOn).length > 0) return EXIT.FINDINGS;
  // Nothing confirmed is only good news if everything was actually looked at.
  // A scan that failed or ran out of budget must not hand CI a green check.
  return coverage.unscanned.length > 0 ? EXIT.ERROR : EXIT.CLEAN;
}
