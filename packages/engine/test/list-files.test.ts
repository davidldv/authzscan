import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { summarizeRepoFiles } from "../src/anthropic-runner.js";

function repoWith(count: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "authzscan-list-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(path.join(dir, "src", `f${i}.ts`), "export const x = 1;\n");
  }
  return dir;
}

describe("summarizeRepoFiles", () => {
  it("lists every path in a small repo", () => {
    const out = summarizeRepoFiles(repoWith(5));
    expect(out.split("\n")).toHaveLength(5);
    expect(out).toContain("src/f0.ts");
  });

  it("returns directory counts instead of 1000 paths", () => {
    const out = summarizeRepoFiles(repoWith(400));
    expect(out).toContain("400 source files");
    expect(out).toContain("src/ (400)");
    expect(out).toContain("grep");
    // The whole point is that this is small enough to re-send every turn.
    expect(out.length).toBeLessThan(500);
  });
});
