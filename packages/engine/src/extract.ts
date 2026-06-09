import type { z } from "zod";

function candidates(text: string): string[] {
  const out: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) out.push(fenced[1].trim());
  out.push(text.trim());
  for (const open of ["[", "{"]) {
    const close = open === "[" ? "]" : "}";
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) out.push(text.slice(start, end + 1));
  }
  return out;
}

export function extractJson<T>(text: string, schema: z.ZodType<T>): T {
  let lastSchemaError: string | null = null;
  let sawJson = false;
  for (const c of candidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(c);
    } catch {
      continue;
    }
    sawJson = true;
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    lastSchemaError = result.error.message;
  }
  if (!sawJson) throw new Error("no JSON value found in agent output");
  throw new Error(`agent output JSON is invalid for the expected schema: ${lastSchemaError}`);
}
