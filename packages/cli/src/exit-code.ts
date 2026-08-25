import type { TFinding } from "@authzscan/shared";

export const EXIT = { CLEAN: 0, FINDINGS: 1, ERROR: 2 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface Coverage {
  analyzed: number;
  total: number;
  unscanned: string[];
}

export function exitCodeForScan(findings: TFinding[], coverage: Coverage): ExitCode {
  if (findings.some((f) => f.verdict === "confirmed")) return EXIT.FINDINGS;
  // Nothing confirmed is only good news if everything was actually looked at.
  // A scan that failed or ran out of budget must not hand CI a green check.
  return coverage.unscanned.length > 0 ? EXIT.ERROR : EXIT.CLEAN;
}
