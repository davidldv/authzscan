import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", ".authzscan"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|prisma)$/;

export function resolveInRepo(repoRoot: string, rel: string): string {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, rel.replace(/\\/g, "/"));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`path escapes repo root: ${rel}`);
  }
  return abs;
}

export function readRepoFile(repoRoot: string, rel: string): string {
  const abs = resolveInRepo(repoRoot, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error(`file not found: ${rel}`);
  }
  const lines = readFileSync(abs, "utf8").split("\n");
  // Trailing empty element after final newline renders as a phantom line — drop it.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((l, i) => `${i + 1}\t${l}`).join("\n") + "\n";
}

export function listRepoFiles(repoRoot: string): string[] {
  const root = path.resolve(repoRoot);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (SOURCE_EXT.test(entry.name)) {
        out.push(path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

export function grepRepo(
  repoRoot: string,
  pattern: string,
  opts: { maxResults?: number } = {},
): GrepHit[] {
  const max = opts.maxResults ?? 100;
  const re = new RegExp(pattern);
  const hits: GrepHit[] = [];
  for (const file of listRepoFiles(repoRoot)) {
    const content = readFileSync(resolveInRepo(repoRoot, file), "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ file, line: i + 1, text: lines[i] });
        if (hits.length >= max) return hits;
      }
    }
  }
  return hits;
}
