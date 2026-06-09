import type { TFinding } from "@authzscan/shared";

export const EXIT = { CLEAN: 0, FINDINGS: 1, ERROR: 2 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitCodeForFindings(findings: TFinding[]): ExitCode {
  return findings.some((f) => f.verdict === "confirmed") ? EXIT.FINDINGS : EXIT.CLEAN;
}
