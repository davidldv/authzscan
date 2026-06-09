import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";

export type ArtifactName = "inventory" | "candidates" | "findings";

export class ArtifactStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = path.join(baseDir, ".authzscan");
  }

  path(name: ArtifactName): string {
    return path.join(this.dir, `${name}.json`);
  }

  write(name: ArtifactName, data: unknown): void {
    this.writeRaw(name, JSON.stringify(data, null, 2));
  }

  writeRaw(name: ArtifactName, raw: string): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(name), raw, "utf8");
  }

  read<T>(name: ArtifactName, schema: z.ZodType<T>): T | null {
    const p = this.path(name);
    if (!existsSync(p)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
      const result = schema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }
}
