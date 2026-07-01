import { describe, it, expect, vi } from "vitest";
import { buildProgram, type ScanOptions } from "../src/program.js";

function parse(argv: string[]) {
  const onScan = vi.fn<(repo: string, opts: ScanOptions) => void>();
  const program = buildProgram(onScan);
  program.exitOverride(); // throw instead of process.exit in tests
  program.parse(["node", "authzscan", ...argv]);
  return onScan;
}

describe("authzscan CLI", () => {
  it("parses scan with defaults", () => {
    const onScan = parse(["scan", "./repo"]);
    expect(onScan).toHaveBeenCalledWith("./repo", {
      format: "md",
      maxEndpoints: undefined,
      budget: undefined,
      resume: false,
      model: "claude-sonnet-4-6",
    });
  });

  it("parses all scan flags", () => {
    const onScan = parse([
      "scan", "../labodega",
      "--format", "sarif",
      "--max-endpoints", "10",
      "--budget", "5",
      "--resume",
      "--model", "claude-opus-4-8",
    ]);
    expect(onScan).toHaveBeenCalledWith("../labodega", {
      format: "sarif",
      maxEndpoints: 10,
      budget: 5,
      resume: true,
      model: "claude-opus-4-8",
    });
  });

  it("rejects invalid format", () => {
    expect(() => parse(["scan", "./repo", "--format", "xml"])).toThrow();
  });

  it("requires repo argument", () => {
    expect(() => parse(["scan"])).toThrow();
  });
});
