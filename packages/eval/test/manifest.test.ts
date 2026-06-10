import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "../src/index.js";
import { runInventory } from "@authzscan/inventory";

const benchmarkDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "benchmark");

describe("loadManifest", () => {
  it("loads and validates the real benchmark manifest", () => {
    const m = loadManifest(benchmarkDir);
    expect(m.vulns).toHaveLength(16);
    expect(m.cleanFiles).toHaveLength(6);
    expect(m.vulns.filter((v) => v.difficulty === "easy")).toHaveLength(6);
    expect(m.vulns.filter((v) => v.difficulty === "medium")).toHaveLength(6);
    expect(m.vulns.filter((v) => v.difficulty === "hard")).toHaveLength(4);
  });

  it("throws on a missing manifest", () => {
    expect(() => loadManifest("/nonexistent")).toThrow(/vulns\.json/);
  });
});

describe("benchmark consistency (manifest ↔ inventory ground truth)", () => {
  const inventory = runInventory(benchmarkDir);
  const endpointFiles = new Set(inventory.endpoints.map((e) => e.file));

  it("inventory parses the whole benchmark with nothing skipped", () => {
    expect(inventory.skippedFiles).toEqual([]);
  });

  it("every seeded vuln file is a discovered endpoint file", () => {
    const m = loadManifest(benchmarkDir);
    for (const v of m.vulns) {
      expect(endpointFiles, `vuln ${v.id} file not in inventory`).toContain(v.file);
    }
  });

  it("every clean file is a discovered endpoint file", () => {
    const m = loadManifest(benchmarkDir);
    for (const f of m.cleanFiles) {
      expect(endpointFiles, `clean file ${f} not in inventory`).toContain(f);
    }
  });

  it("vuln files and clean files do not overlap", () => {
    const m = loadManifest(benchmarkDir);
    const vulnFiles = new Set(m.vulns.map((v) => v.file));
    for (const f of m.cleanFiles) expect(vulnFiles).not.toContain(f);
  });
});
