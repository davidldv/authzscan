import type { TEndpoint, TAuthProfile, TCandidateFinding } from "@authzscan/shared";

// Defensive framing is load-bearing: Fable 5 routes some offensive-security
// prompts to a fallback model; code-review framing keeps us in the Fable lane.
export const SYSTEM_PROMPT = `You are an application security engineer performing defensive code review of a Next.js App Router codebase. Your sole focus is object-level authorization (IDOR/BOLA): finding database reads or writes keyed by a client-supplied identifier that lack an ownership or tenancy check, so the team can fix them.

You have tools to read files, grep, and list files in the repository under review. Evidence must cite real file paths and line numbers you actually read. Never invent code you have not seen. When asked for JSON, reply with JSON only — no prose around it.`;

export interface TracePromptInput {
  groupKey: string;
  endpoints: TEndpoint[];
  authProfile: TAuthProfile;
}

export function buildTracePrompt(input: TracePromptInput): string {
  return `Analyze the endpoint group "${input.groupKey}" for missing object-level authorization.

Repository auth context (how THIS repo does auth — judge endpoints against these idioms):
${JSON.stringify(input.authProfile, null, 2)}

Endpoints in this group:
${JSON.stringify(input.endpoints, null, 2)}

For each endpoint: read its file, trace every client-controlled identifier (route params, body fields, query params) to the database query it reaches, and decide whether the query is scoped to the requesting user/tenant. A query keyed only by the client-supplied id, with no ownership filter and no prior ownership check, is a candidate finding. Mutations (DELETE/PUT/PATCH/actions) deserve extra scrutiny — a check on GET does not protect its sibling DELETE.

Reply with ONLY a JSON array of candidate findings (empty array if none), each object exactly:
{
  "id": "<unique slug>",
  "endpointId": "<endpoint id from the list above>",
  "title": "<one line>",
  "description": "<what is fetched/mutated and what check is missing>",
  "evidence": [{ "file": "<repo-relative path>", "startLine": <int>, "endLine": <int>, "note": "<why this span matters>" }]
}`;
}

export interface VerifyPromptInput {
  candidate: TCandidateFinding;
  authProfile: TAuthProfile;
}

export function buildVerifyPrompt(input: VerifyPromptInput): string {
  return `You are now adversarially verifying a candidate IDOR finding produced by a previous reviewer. Your job is to kill false positives: re-read the cited code yourself and either prove the issue real with a concrete scenario, or reject it.

Repository auth context:
${JSON.stringify(input.authProfile, null, 2)}

Candidate finding:
${JSON.stringify(input.candidate, null, 2)}

Re-read the evidence files. Check for: middleware that already scopes the request, ownership checks earlier in the call chain, framework-level protections, and whether the identifier is truly client-controlled. Confirm ONLY if you can articulate a concrete unauthorized-access scenario (user A's session reaching user B's resource).

Reply with ONLY one JSON object exactly:
{
  "verdict": "confirmed" | "rejected",
  "confidence": "high" | "medium" | "low",
  "reproduction": "<concrete scenario, or why it was rejected>",
  "suggestedFix": "<minimal code change, or empty string if rejected>"
}`;
}
