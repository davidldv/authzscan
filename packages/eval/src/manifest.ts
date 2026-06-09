import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const Vuln = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  type: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  description: z.string().min(1),
});

export const Manifest = z.object({
  vulns: z.array(Vuln).min(1),
  cleanFiles: z.array(z.string()),
});

export type TVuln = z.infer<typeof Vuln>;
export type TManifest = z.infer<typeof Manifest>;

export function loadManifest(benchmarkDir: string): TManifest {
  const p = path.join(benchmarkDir, "vulns.json");
  if (!existsSync(p)) throw new Error(`manifest not found: ${p} (expected vulns.json in benchmark dir)`);
  return Manifest.parse(JSON.parse(readFileSync(p, "utf8")));
}
