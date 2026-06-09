import type { TokenUsage } from "./usage.js";

export interface AgentRunResult {
  text: string;
  usage: TokenUsage;
}

export interface AgentRunRequest {
  system: string;
  prompt: string;
  repoRoot: string;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export interface RetryOptions {
  retries: number;
  delayMs: number;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.retries) {
        await new Promise((r) => setTimeout(r, opts.delayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
