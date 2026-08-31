import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readBaseline, writeBaseline, applyBaseline } from "../src/baseline.js";
import type { TFinding } from "@authzscan/shared";

const finding = (over: Partial<TFinding> = {}): TFinding => ({
  id: "f1",
  endpointId: "ep_app_api_orders__id__route_ts_get",
  title: "IDOR on order lookup",
  description: "d",
  evidence: [{ file: "a.ts", startLine: 1, endLine: 2, note: "n" }],
  verdict: "confirmed",
  confidence: "high",
  reproduction: "r",
  suggestedFix: "s",
  ...over,
});

function tmpFile(name: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "authzscan-")), name);
}

describe("baseline", () => {
  it("round-trips through write and read", () => {
    const file = tmpFile("baseline.json");
    expect(writeBaseline(file, [finding()])).toBe(1);
    expect(readBaseline(file)).toEqual(new Set(["ep_app_api_orders__id__route_ts_get"]));
  });

  it("records one entry per endpoint, not per finding", () => {
    const file = tmpFile("baseline.json");
    expect(writeBaseline(file, [finding({ id: "f1" }), finding({ id: "f2" })])).toBe(1);
  });

  it("never records a rejected finding", () => {
    const file = tmpFile("baseline.json");
    expect(writeBaseline(file, [finding({ verdict: "rejected" })])).toBe(0);
  });

  it("keeps the title as a human hint, and an empty reason to fill in", () => {
    const file = tmpFile("baseline.json");
    writeBaseline(file, [finding()]);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { accepted: Array<{ title: string; reason: string }> };
    expect(parsed.accepted[0]).toMatchObject({ title: "IDOR on order lookup", reason: "" });
  });

  it("throws rather than failing open on a missing file", () => {
    expect(() => readBaseline(tmpFile("nope.json"))).toThrow(/file not found/);
  });

  it("throws rather than failing open on a malformed file", () => {
    const file = tmpFile("bad.json");
    writeFileSync(file, '{"version":99,"accepted":[]}', "utf8");
    expect(() => readBaseline(file)).toThrow(/not a valid baseline/);
  });

  it("throws on a file that is not JSON at all", () => {
    const file = tmpFile("bad.json");
    writeFileSync(file, "nope", "utf8");
    expect(() => readBaseline(file)).toThrow(/not valid JSON/);
  });

  it("splits findings by accepted endpoint", () => {
    const kept = finding({ endpointId: "ep_new" });
    const { active, suppressed } = applyBaseline([finding(), kept], new Set(["ep_app_api_orders__id__route_ts_get"]));
    expect(active).toEqual([kept]);
    expect(suppressed).toHaveLength(1);
  });
});
