import { z } from "zod";
import { Confidence, type TCandidateFinding, type TFinding, type TAuthProfile } from "@authzscan/shared";
import { buildVerifyPrompt, SYSTEM_PROMPT } from "./prompts.js";
import { extractJson } from "./extract.js";
import { withRetry, type AgentRunner, type RetryOptions } from "./runner.js";
import type { BudgetGuard } from "./usage.js";

const Verdict = z.object({
  verdict: z.enum(["confirmed", "rejected"]),
  confidence: Confidence,
  reproduction: z.string(),
  suggestedFix: z.string(),
});

export interface VerifyPhaseInput {
  candidates: TCandidateFinding[];
  authProfile: TAuthProfile;
  repoRoot: string;
  runner: AgentRunner;
  guard: BudgetGuard;
  retry: RetryOptions;
  log?: (message: string) => void;
}

export interface VerifyPhaseResult {
  findings: TFinding[];
  budgetExceeded: boolean;
}

// Degrade loudly: a candidate we could not verify is reported, not dropped —
// a false "clean" is worse than a noisy report.
function unverified(candidate: TCandidateFinding, reason: string): TFinding {
  return {
    ...candidate,
    verdict: "confirmed",
    confidence: "low",
    reproduction: `UNVERIFIED — verification failed: ${reason}. Treat as an unreviewed candidate, not a confirmed vulnerability.`,
    suggestedFix: "",
  };
}

export async function runVerifyPhase(input: VerifyPhaseInput): Promise<VerifyPhaseResult> {
  const findings: TFinding[] = [];
  let budgetExceeded = false;

  for (const candidate of input.candidates) {
    if (input.guard.exceeded()) {
      budgetExceeded = true;
      findings.push(unverified(candidate, "scan budget exhausted before this candidate was verified"));
      continue;
    }
    const prompt = buildVerifyPrompt({ candidate, authProfile: input.authProfile });
    try {
      const verdict = await withRetry(async () => {
        const result = await input.runner.run({ system: SYSTEM_PROMPT, prompt, repoRoot: input.repoRoot });
        input.guard.record(result.usage);
        return extractJson(result.text, Verdict);
      }, input.retry);
      findings.push({ ...candidate, ...verdict });
      input.log?.(`verified ${candidate.id}: ${verdict.verdict} (${verdict.confidence})`);
    } catch (err) {
      findings.push(unverified(candidate, err instanceof Error ? err.message : String(err)));
      input.log?.(`verify FAILED for ${candidate.id}`);
    }
  }

  return { findings, budgetExceeded };
}
