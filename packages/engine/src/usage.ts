export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

// USD per million tokens. Cache read ≈ 0.1× input price, cache write ≈ 1.25×.
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function estimateUsd(usage: TokenUsage, model: string): number {
  const price = PRICES_PER_MTOK[model] ?? PRICES_PER_MTOK["claude-fable-5"];
  return (
    (usage.inputTokens / 1e6) * price.input +
    (usage.outputTokens / 1e6) * price.output +
    (usage.cacheReadTokens / 1e6) * price.input * 0.1 +
    (usage.cacheCreationTokens / 1e6) * price.input * 1.25
  );
}

export class BudgetGuard {
  private usage = emptyUsage();

  constructor(
    private readonly budgetUsd: number | undefined,
    private readonly model: string,
  ) {}

  record(usage: TokenUsage): void {
    this.usage = addUsage(this.usage, usage);
  }

  spentUsd(): number {
    return estimateUsd(this.usage, this.model);
  }

  total(): TokenUsage {
    return this.usage;
  }

  exceeded(): boolean {
    return this.budgetUsd !== undefined && this.spentUsd() >= this.budgetUsd;
  }
}
