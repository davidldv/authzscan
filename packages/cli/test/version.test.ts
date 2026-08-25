import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { VERSION } from "@authzscan/shared";

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");

describe("version", () => {
  it("matches the published package version", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
