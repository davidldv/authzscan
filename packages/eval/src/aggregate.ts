import type { Classification, Metrics } from "./classify.js";

export interface RunOutcome {
  metrics: Metrics;
  classification: Classification;
  costUsd: number;
  durationMs: number;
}

export interface Stat {
  mean: number;
  stddev: number;
}

function stat(values: number[]): Stat {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, stddev: 0 };
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, stddev: Math.sqrt(variance) };
}

export interface Aggregate {
  recall: Stat;
  precision: Stat;
  costUsd: Stat;
  durationMs: Stat;
}

export function aggregateRuns(runs: RunOutcome[]): Aggregate {
  return {
    recall: stat(runs.map((r) => r.metrics.recall)),
    precision: stat(runs.map((r) => r.metrics.precision)),
    costUsd: stat(runs.map((r) => r.costUsd)),
    durationMs: stat(runs.map((r) => r.durationMs)),
  };
}
