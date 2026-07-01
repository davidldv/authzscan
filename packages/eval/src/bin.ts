import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { AnthropicRunner, type AgentRunner } from "@authzscan/engine";
import { loadManifest } from "./manifest.js";
import { PerfectRunner } from "./perfect-runner.js";
import { runEval, GATES } from "./run-eval.js";

const program = new Command();

program
  .name("authzscan-eval")
  .description("Run the authzscan benchmark eval and write a gated report")
  .argument("[benchmark]", "path to the benchmark directory", "benchmark")
  .option("--runs <n>", "number of eval runs", (v) => Number.parseInt(v, 10), 3)
  .option("--model <model>", "model id", "claude-sonnet-4-6")
  .option("--budget <usd>", "max spend per scan in USD", (v) => Number.parseFloat(v))
  .option("--fake", "use the PerfectRunner oracle instead of the API (no cost; harness sanity check)", false)
  .action(async (benchmark: string, opts: { runs: number; model: string; budget?: number; fake: boolean }) => {
    const benchmarkDir = path.resolve(benchmark);
    const runner: AgentRunner = opts.fake
      ? new PerfectRunner(loadManifest(benchmarkDir))
      : new AnthropicRunner({ model: opts.model });

    const result = await runEval({
      benchmarkDir,
      runner,
      model: opts.model,
      runs: opts.runs,
      budgetUsd: opts.budget,
      log: (m) => console.log(m),
    });

    const reportDir = path.resolve("eval-reports");
    mkdirSync(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(reportDir, `${stamp}${opts.fake ? "-fake" : ""}.md`);
    writeFileSync(reportPath, result.report, "utf8");

    console.log(`\n${result.report}`);
    console.log(`report written: ${reportPath}`);
    console.log(
      `gates (recall >=${GATES.recall * 100}%, precision >=${GATES.precision * 100}%): ${result.gatesPassed ? "PASS" : "FAIL"}`,
    );
    process.exitCode = result.gatesPassed ? 0 : 1;
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
