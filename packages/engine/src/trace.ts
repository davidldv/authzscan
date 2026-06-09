import { z } from "zod";
import { CandidateFinding, type TCandidateFinding, type TEndpoint, type TAuthProfile } from "@authzscan/shared";
import { groupEndpoints } from "./group.js";
import { buildTracePrompt, SYSTEM_PROMPT } from "./prompts.js";
import { extractJson } from "./extract.js";
import { withRetry, type AgentRunner, type RetryOptions } from "./runner.js";
import type { BudgetGuard } from "./usage.js";

const CandidateArray = z.array(CandidateFinding);

export interface TracePhaseInput {
  endpoints: TEndpoint[];
  authProfile: TAuthProfile;
  repoRoot: string;
  runner: AgentRunner;
  guard: BudgetGuard;
  retry: RetryOptions;
  log?: (message: string) => void;
}

export interface TracePhaseResult {
  candidates: TCandidateFinding[];
  unscannedEndpointIds: string[];
  budgetExceeded: boolean;
}

async function runOnce(
  input: TracePhaseInput,
  prompt: string,
): Promise<TCandidateFinding[]> {
  const result = await input.runner.run({ system: SYSTEM_PROMPT, prompt, repoRoot: input.repoRoot });
  input.guard.record(result.usage);
  try {
    return extractJson(result.text, CandidateArray);
  } catch (err) {
    // One re-prompt with the validation error, per spec. Then give up on the group.
    const correction = `${prompt}\n\nYour previous reply was not valid:\n${err instanceof Error ? err.message : String(err)}\nReply again with ONLY the JSON array, no other text.`;
    const second = await input.runner.run({ system: SYSTEM_PROMPT, prompt: correction, repoRoot: input.repoRoot });
    input.guard.record(second.usage);
    return extractJson(second.text, CandidateArray);
  }
}

export async function runTracePhase(input: TracePhaseInput): Promise<TracePhaseResult> {
  const groups = groupEndpoints(input.endpoints);
  const candidates: TCandidateFinding[] = [];
  const unscannedEndpointIds: string[] = [];
  let budgetExceeded = false;

  for (const group of groups) {
    if (input.guard.exceeded()) {
      budgetExceeded = true;
      unscannedEndpointIds.push(...group.endpoints.map((e) => e.id));
      continue;
    }
    const prompt = buildTracePrompt({ groupKey: group.key, endpoints: group.endpoints, authProfile: input.authProfile });
    try {
      const found = await withRetry(() => runOnce(input, prompt), input.retry);
      candidates.push(...found);
      input.log?.(`traced ${group.key}: ${found.length} candidate(s)`);
    } catch (err) {
      unscannedEndpointIds.push(...group.endpoints.map((e) => e.id));
      input.log?.(`trace FAILED for ${group.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { candidates, unscannedEndpointIds, budgetExceeded };
}
