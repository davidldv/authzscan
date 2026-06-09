import { z } from "zod";

export const Confidence = z.enum(["high", "medium", "low"]);

export const Evidence = z.object({
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  note: z.string(),
});

export const CandidateFinding = z.object({
  id: z.string().min(1),
  endpointId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  evidence: z.array(Evidence).min(1),
});

export const Finding = CandidateFinding.extend({
  verdict: z.enum(["confirmed", "rejected"]),
  confidence: Confidence,
  reproduction: z.string(),
  suggestedFix: z.string(),
});

export type TConfidence = z.infer<typeof Confidence>;
export type TEvidence = z.infer<typeof Evidence>;
export type TCandidateFinding = z.infer<typeof CandidateFinding>;
export type TFinding = z.infer<typeof Finding>;

const confidenceRank: Record<TConfidence, number> = { high: 3, medium: 2, low: 1 };

export function sortFindings(findings: TFinding[]): TFinding[] {
  return [...findings].sort(
    (a, b) => confidenceRank[b.confidence] - confidenceRank[a.confidence],
  );
}
