import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveInRepo, readRepoFile, grepRepo, listRepoFiles } from "../src/index.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "authzscan-repo-"));
  mkdirSync(path.join(repo, "app", "api"), { recursive: true });
  mkdirSync(path.join(repo, "node_modules", "junk"), { recursive: true });
  writeFileSync(path.join(repo, "app", "api", "route.ts"), "export async function GET() {\n  return prisma.order.findMany();\n}\n");
  writeFileSync(path.join(repo, "lib.ts"), "export const x = 1;\n");
  writeFileSync(path.join(repo, "node_modules", "junk", "index.js"), "prisma\n");
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("resolveInRepo", () => {
  it("resolves relative paths inside the repo", () => {
    expect(resolveInRepo(repo, "lib.ts")).toBe(path.join(repo, "lib.ts"));
  });

  it("rejects traversal escapes", () => {
    expect(() => resolveInRepo(repo, "../outside.txt")).toThrow(/escapes repo root/);
    expect(() => resolveInRepo(repo, "..\\outside.txt")).toThrow(/escapes repo root/);
  });
});

describe("readRepoFile", () => {
  it("reads file content with line numbers", () => {
    const text = readRepoFile(repo, "lib.ts");
    expect(text).toBe("1\texport const x = 1;\n");
  });

  it("errors clearly on missing files", () => {
    expect(() => readRepoFile(repo, "nope.ts")).toThrow(/not found/i);
  });

  it("refuses a non-source file so secrets cannot reach a prompt", () => {
    writeFileSync(path.join(repo, ".env"), "SECRET=do-not-send-me", "utf8");
    expect(() => readRepoFile(repo, ".env")).toThrow(/not a source file/);
  });
});

describe("grepRepo", () => {
  it("finds matches with file and line info, skipping node_modules", () => {
    const hits = grepRepo(repo, "prisma");
    expect(hits).toEqual([
      { file: "app/api/route.ts", line: 2, text: "  return prisma.order.findMany();" },
    ]);
  });

  it("caps result count", () => {
    const hits = grepRepo(repo, "export", { maxResults: 1 });
    expect(hits).toHaveLength(1);
  });
});

describe("listRepoFiles", () => {
  it("lists source files relative to root, skipping node_modules and .git", () => {
    expect(listRepoFiles(repo)).toEqual(["app/api/route.ts", "lib.ts"]);
  });
});
