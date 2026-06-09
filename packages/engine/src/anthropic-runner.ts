import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AgentRunner, AgentRunRequest, AgentRunResult } from "./runner.js";
import { emptyUsage, addUsage, type TokenUsage } from "./usage.js";
import { readRepoFile, grepRepo, listRepoFiles } from "./repo-fs.js";

function buildRepoTools(repoRoot: string) {
  return [
    betaZodTool({
      name: "read_file",
      description:
        "Read a source file from the repository under review. Call this for every file you cite as evidence — never cite code you have not read. Returns the content with line numbers.",
      inputSchema: z.object({
        path: z.string().describe("Repo-relative file path, e.g. app/api/orders/[id]/route.ts"),
      }),
      run: ({ path: p }) => readRepoFile(repoRoot, p),
    }),
    betaZodTool({
      name: "grep",
      description:
        "Search all source files in the repository with a JavaScript regular expression. Call this to find where a function, model, or identifier is defined or used (e.g. auth helpers, prisma models). Returns file, line number, and the matching line.",
      inputSchema: z.object({
        pattern: z.string().describe("JavaScript regex source, e.g. getServerSession|auth\\("),
      }),
      run: ({ pattern }) => JSON.stringify(grepRepo(repoRoot, pattern), null, 2),
    }),
    betaZodTool({
      name: "list_files",
      description:
        "List all source file paths in the repository. Call this when you need to discover related files (middleware, lib/auth, prisma schema) before reading them.",
      inputSchema: z.object({}),
      run: () => listRepoFiles(repoRoot).join("\n"),
    }),
  ];
}

export interface AnthropicRunnerOptions {
  model: string;
  maxTokensPerCall?: number;
}

export class AnthropicRunner implements AgentRunner {
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicRunnerOptions, client?: Anthropic) {
    // Default client resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile.
    this.client = client ?? new Anthropic();
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const runner = this.client.beta.messages.toolRunner({
      model: this.options.model,
      max_tokens: this.options.maxTokensPerCall ?? 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: request.system,
      tools: buildRepoTools(request.repoRoot),
      messages: [{ role: "user", content: request.prompt }],
    });

    let usage: TokenUsage = emptyUsage();
    let lastText = "";
    for await (const message of runner) {
      usage = addUsage(usage, {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
      });
      const text = message.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text.trim() !== "") lastText = text;
    }
    return { text: lastText, usage };
  }
}
