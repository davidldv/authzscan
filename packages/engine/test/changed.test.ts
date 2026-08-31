import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedFiles } from "../src/changed.js";

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "authzscan-git-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(path.join(dir, "kept.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base");
  return dir;
}

describe("changedFiles", () => {
  it("lists files that differ from the ref, repo-relative with forward slashes", () => {
    const dir = initRepo();
    mkdirSync(path.join(dir, "app", "api"), { recursive: true });
    writeFileSync(path.join(dir, "app", "api", "route.ts"), "export const GET = 1;\n");
    execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
    expect(changedFiles(dir, "HEAD")).toEqual(new Set(["app/api/route.ts"]));
  });

  it("returns an empty set when nothing changed", () => {
    expect(changedFiles(initRepo(), "HEAD")).toEqual(new Set());
  });

  it("throws on a ref git cannot resolve instead of narrowing the scan to nothing", () => {
    expect(() => changedFiles(initRepo(), "origin/does-not-exist")).toThrow(/could not diff/);
  });
});
