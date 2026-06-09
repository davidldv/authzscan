import { Command, InvalidArgumentError, Option } from "commander";

export interface ScanOptions {
  format: "md" | "sarif" | "json";
  maxEndpoints: number | undefined;
  budget: number | undefined;
  resume: boolean;
  model: string;
}

function parsePositiveNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new InvalidArgumentError("must be a positive number");
  }
  return n;
}

export function buildProgram(onScan: (repo: string, opts: ScanOptions) => void): Command {
  const program = new Command();
  program.name("authzscan").description("Autonomous IDOR/BOLA review for Next.js App Router").version("0.1.0");

  program
    .command("scan")
    .argument("<repo>", "path to the Next.js repo to scan")
    .addOption(new Option("--format <fmt>", "output format").choices(["md", "sarif", "json"]).default("md"))
    .option("--max-endpoints <n>", "limit number of endpoints analyzed", parsePositiveNumber)
    .option("--budget <usd>", "halt scan at estimated spend (USD)", parsePositiveNumber)
    .option("--resume", "resume from .authzscan/ artifacts", false)
    .option("--model <id>", "Anthropic model id", "claude-fable-5")
    .action((repo: string, opts: ScanOptions) => {
      onScan(repo, {
        format: opts.format,
        maxEndpoints: opts.maxEndpoints,
        budget: opts.budget,
        resume: opts.resume,
        model: opts.model,
      });
    });

  return program;
}
