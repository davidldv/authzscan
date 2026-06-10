import type { AgentRunner, AgentRunRequest, AgentRunResult, TokenUsage } from "@authzscan/engine";
import type { TEndpoint } from "@authzscan/shared";
import type { TManifest } from "./manifest.js";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

const ENDPOINTS_HEADER = "Endpoints in this group:\n";

function parseEndpointsFromPrompt(prompt: string): TEndpoint[] {
  const start = prompt.indexOf(ENDPOINTS_HEADER);
  if (start === -1) return [];
  const jsonStart = prompt.indexOf("[", start);
  if (jsonStart === -1) return [];
  // Bracket-scan to the matching close so trailing prompt prose doesn't break parsing.
  let depth = 0;
  for (let i = jsonStart; i < prompt.length; i++) {
    if (prompt[i] === "[") depth++;
    else if (prompt[i] === "]") {
      depth--;
      if (depth === 0) return JSON.parse(prompt.slice(jsonStart, i + 1)) as TEndpoint[];
    }
  }
  return [];
}

/**
 * Oracle runner for the eval harness sanity gate: answers trace prompts straight
 * from the benchmark manifest and confirms every candidate. If the pipeline is
 * wired correctly it MUST score recall 1.0 / precision 1.0 — anything less means
 * the harness (not the model) is broken.
 */
export class PerfectRunner implements AgentRunner {
  constructor(private readonly manifest: TManifest) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (request.prompt.includes("adversarially verifying")) {
      return {
        text: JSON.stringify({
          verdict: "confirmed",
          confidence: "high",
          reproduction: "oracle: seeded vulnerability from benchmark manifest",
          suggestedFix: "scope the query to the requesting user",
        }),
        usage: ZERO_USAGE,
      };
    }

    const vulnByFile = new Map(this.manifest.vulns.map((v) => [v.file, v]));
    const seenFiles = new Set<string>();
    const candidates = [];
    for (const endpoint of parseEndpointsFromPrompt(request.prompt)) {
      const vuln = vulnByFile.get(endpoint.file);
      if (!vuln || seenFiles.has(endpoint.file)) continue;
      seenFiles.add(endpoint.file);
      candidates.push({
        id: `oracle-${vuln.id.toLowerCase()}`,
        endpointId: endpoint.id,
        title: vuln.description,
        description: vuln.description,
        evidence: [{ file: vuln.file, startLine: 1, endLine: 1, note: "oracle: manifest-seeded location" }],
      });
    }
    return { text: JSON.stringify(candidates), usage: ZERO_USAGE };
  }
}
