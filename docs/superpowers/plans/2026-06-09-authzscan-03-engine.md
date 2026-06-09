# authzscan Plan 03: Engine (trace + verify) + CLI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@authzscan/engine` — the LLM phases (trace agents per endpoint group, adversarial verify per candidate) plus full CLI wiring, so `authzscan scan ./repo` runs end-to-end: inventory → trace → verify → report.md + results.sarif + exit code.

**Architecture:** Anthropic TypeScript SDK with the beta tool runner (`betaZodTool` + `client.beta.messages.toolRunner`). The engine is runner-agnostic: orchestration code depends on an `AgentRunner` interface; production implements it with the SDK, tests implement it with fakes (no live LLM in CI, per spec). Every phase writes a resumable artifact to `.authzscan/`; budget tracking accumulates real token usage and halts cleanly. Degrade loudly: failed groups → `unscanned` in the report, never silently dropped.

**Spec deviation (flagged):** Spec named "Claude Agent SDK". This plan uses `@anthropic-ai/sdk` + tool runner instead — per Anthropic's surface-selection guidance, "custom agent with your own tools / you control the loop" is Claude API + tool use. We need: sandboxed repo-scoped tools, per-phase orchestration, prompt-level control for caching, zod-validated outputs, budget accounting. The Agent SDK's Claude-Code-shaped harness would be fought, not used. Auth intent preserved: the SDK resolves `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile automatically.

**Tech Stack:** `@anthropic-ai/sdk` (latest, beta tool runner), zod 4, vitest, existing `@authzscan/shared` + `@authzscan/inventory`.

**Model facts (from claude-api skill, do not "correct" these):** Fable 5 id is `claude-fable-5` ($10/$50 per MTok, 1M ctx). Adaptive thinking only: `thinking: {type: "adaptive"}`; an explicit `{type: "disabled"}` 400s on Fable — omit instead. No `temperature`/`top_p`/`top_k`. Effort via `output_config: {effort: "high"}`. Usage fields: `input_tokens`, `output_tokens`, `cache_read_input_tokens` (~0.1× input price), `cache_creation_input_tokens` (~1.25× input price).

**Plan series:** 01 foundation (merged) → 02 inventory (merged) → **03 engine + CLI (this)** → 04 benchmark + eval.

**Spec:** `docs/superpowers/specs/2026-06-09-authzscan-mvp-design.md`

---

### Task 1: Package scaffold + endpoint grouping

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/src/group.ts`
- Create: `packages/engine/src/index.ts`
- Test: `packages/engine/test/group.test.ts`

- [ ] **Step 1: Create package scaffold and install the SDK**

`packages/engine/package.json`:
```json
{
  "name": "@authzscan/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@authzscan/inventory": "workspace:*",
    "@authzscan/shared": "workspace:*",
    "zod": "^4.0.0"
  }
}
```

`packages/engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`, then `pnpm --filter @authzscan/engine add @anthropic-ai/sdk`
(Installing via command rather than hand-pinning keeps us on the current SDK release.)

- [ ] **Step 2: Write the failing test**

`packages/engine/test/group.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { groupEndpoints } from "../src/index.js";
import type { TEndpoint } from "@authzscan/shared";

function ep(overrides: Partial<TEndpoint>): TEndpoint {
  return {
    id: "ep_x",
    kind: "route-handler",
    file: "app/api/x/route.ts",
    method: "GET",
    routePath: "/api/x",
    params: [],
    usesDb: true,
    authIndicators: [],
    ...overrides,
  };
}

describe("groupEndpoints", () => {
  it("groups route handlers by resource path (dynamic segments stripped)", () => {
    const a = ep({ id: "a", routePath: "/api/orders", file: "app/api/orders/route.ts" });
    const b = ep({ id: "b", routePath: "/api/orders/[id]", file: "app/api/orders/[id]/route.ts", params: ["id"] });
    const c = ep({ id: "c", routePath: "/api/users/[id]", file: "app/api/users/[id]/route.ts", params: ["id"] });
    const groups = groupEndpoints([a, b, c]);
    expect(groups.map((g) => g.key)).toEqual(["/api/orders", "/api/users"]);
    expect(groups[0].endpoints.map((e) => e.id)).toEqual(["a", "b"]);
    expect(groups[1].endpoints.map((e) => e.id)).toEqual(["c"]);
  });

  it("groups server actions by their file directory", () => {
    const a = ep({ id: "a", kind: "server-action", method: null, routePath: null, file: "app/orders/actions.ts" });
    const b = ep({ id: "b", kind: "server-action", method: null, routePath: null, file: "app/orders/actions.ts" });
    const groups = groupEndpoints([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("app/orders");
  });

  it("is deterministic: groups sorted by key, endpoints keep input order", () => {
    const a = ep({ id: "a", routePath: "/api/z", file: "app/api/z/route.ts" });
    const b = ep({ id: "b", routePath: "/api/a", file: "app/api/a/route.ts" });
    expect(groupEndpoints([a, b]).map((g) => g.key)).toEqual(["/api/a", "/api/z"]);
  });

  it("skips db-free endpoints with no params (nothing to trace)", () => {
    const skip = ep({ id: "skip", usesDb: false, params: [], routePath: "/api/health", file: "app/api/health/route.ts" });
    const keep = ep({ id: "keep", routePath: "/api/orders/[id]", params: ["id"], file: "app/api/orders/[id]/route.ts" });
    const groups = groupEndpoints([skip, keep]);
    expect(groups.flatMap((g) => g.endpoints.map((e) => e.id))).toEqual(["keep"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/test/group.test.ts`
Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 4: Write minimal implementation**

`packages/engine/src/group.ts`:
```ts
import type { TEndpoint } from "@authzscan/shared";

export interface EndpointGroup {
  key: string;
  endpoints: TEndpoint[];
}

function groupKey(e: TEndpoint): string {
  if (e.routePath !== null) {
    const segs = e.routePath.split("/").filter((s) => s !== "" && !s.startsWith("["));
    return segs.length === 0 ? "/" : `/${segs.join("/")}`;
  }
  const parts = e.file.replace(/\\/g, "/").split("/");
  return parts.slice(0, -1).join("/");
}

export function groupEndpoints(endpoints: TEndpoint[]): EndpointGroup[] {
  const relevant = endpoints.filter((e) => e.usesDb || e.params.length > 0);
  const byKey = new Map<string, TEndpoint[]>();
  for (const e of relevant) {
    const key = groupKey(e);
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, eps]) => ({ key, endpoints: eps }));
}
```

`packages/engine/src/index.ts`:
```ts
export * from "./group.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/engine/test/group.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine pnpm-lock.yaml
git commit -m "feat(engine): scaffold package with endpoint grouping"
```

---

### Task 2: Usage accounting + budget guard

**Files:**
- Create: `packages/engine/src/usage.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/usage.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/usage.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { emptyUsage, addUsage, estimateUsd, BudgetGuard } from "../src/index.js";

describe("usage accounting", () => {
  it("adds usage immutably", () => {
    const a = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 };
    const sum = addUsage(emptyUsage(), a);
    expect(sum).toEqual(a);
    expect(addUsage(sum, a)).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
    });
  });

  it("estimates USD for claude-fable-5 ($10 in / $50 out per MTok, cache 0.1x/1.25x)", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    };
    // 10 + 50 + 1 (0.1*10) + 12.5 (1.25*10) = 73.5
    expect(estimateUsd(usage, "claude-fable-5")).toBeCloseTo(73.5, 5);
  });

  it("falls back to fable pricing for unknown models (conservative)", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    expect(estimateUsd(usage, "some-future-model")).toBeCloseTo(10, 5);
  });
});

describe("BudgetGuard", () => {
  it("is never exceeded without a budget", () => {
    const guard = new BudgetGuard(undefined, "claude-fable-5");
    guard.record({ inputTokens: 9_999_999, outputTokens: 9_999_999, cacheReadTokens: 0, cacheCreationTokens: 0 });
    expect(guard.exceeded()).toBe(false);
  });

  it("trips once estimated spend reaches the budget", () => {
    const guard = new BudgetGuard(0.5, "claude-fable-5");
    expect(guard.exceeded()).toBe(false);
    guard.record({ inputTokens: 0, outputTokens: 10_000, cacheReadTokens: 0, cacheCreationTokens: 0 }); // $0.50
    expect(guard.exceeded()).toBe(true);
    expect(guard.spentUsd()).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/test/usage.test.ts`
Expected: FAIL — `emptyUsage` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/engine/src/usage.ts`:
```ts
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

// USD per million tokens. Cache read ≈ 0.1× input price, cache write ≈ 1.25×.
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function estimateUsd(usage: TokenUsage, model: string): number {
  const price = PRICES_PER_MTOK[model] ?? PRICES_PER_MTOK["claude-fable-5"];
  return (
    (usage.inputTokens / 1e6) * price.input +
    (usage.outputTokens / 1e6) * price.output +
    (usage.cacheReadTokens / 1e6) * price.input * 0.1 +
    (usage.cacheCreationTokens / 1e6) * price.input * 1.25
  );
}

export class BudgetGuard {
  private usage = emptyUsage();

  constructor(
    private readonly budgetUsd: number | undefined,
    private readonly model: string,
  ) {}

  record(usage: TokenUsage): void {
    this.usage = addUsage(this.usage, usage);
  }

  spentUsd(): number {
    return estimateUsd(this.usage, this.model);
  }

  total(): TokenUsage {
    return this.usage;
  }

  exceeded(): boolean {
    return this.budgetUsd !== undefined && this.spentUsd() >= this.budgetUsd;
  }
}
```

`packages/engine/src/index.ts`:
```ts
export * from "./group.js";
export * from "./usage.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/engine/test/usage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add token usage accounting and budget guard"
```

---

### Task 3: Artifact store (`.authzscan/`, resume support)

**Files:**
- Create: `packages/engine/src/artifacts.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/artifacts.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/artifacts.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { ArtifactStore } from "../src/index.js";

const Shape = z.object({ value: z.number() });
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "authzscan-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ArtifactStore", () => {
  it("round-trips a validated artifact", () => {
    const store = new ArtifactStore(dir);
    store.write("inventory", { value: 42 });
    expect(store.read("inventory", Shape)).toEqual({ value: 42 });
  });

  it("returns null for missing artifacts", () => {
    const store = new ArtifactStore(dir);
    expect(store.read("candidates", Shape)).toBeNull();
  });

  it("returns null (not garbage) for corrupt artifacts", () => {
    const store = new ArtifactStore(dir);
    store.writeRaw("findings", "{not json");
    expect(store.read("findings", Shape)).toBeNull();
  });

  it("returns null for schema-invalid artifacts", () => {
    const store = new ArtifactStore(dir);
    store.write("inventory", { wrong: true });
    expect(store.read("inventory", Shape)).toBeNull();
  });

  it("creates the .authzscan directory under the target dir", () => {
    const store = new ArtifactStore(dir);
    store.write("inventory", { value: 1 });
    expect(store.path("inventory")).toBe(path.join(dir, ".authzscan", "inventory.json"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/test/artifacts.test.ts`
Expected: FAIL — `ArtifactStore` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/engine/src/artifacts.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";

export type ArtifactName = "inventory" | "candidates" | "findings";

export class ArtifactStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = path.join(baseDir, ".authzscan");
  }

  path(name: ArtifactName): string {
    return path.join(this.dir, `${name}.json`);
  }

  write(name: ArtifactName, data: unknown): void {
    this.writeRaw(name, JSON.stringify(data, null, 2));
  }

  writeRaw(name: ArtifactName, raw: string): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(name), raw, "utf8");
  }

  read<T>(name: ArtifactName, schema: z.ZodType<T>): T | null {
    const p = this.path(name);
    if (!existsSync(p)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
      const result = schema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }
}
```

`packages/engine/src/index.ts`:
```ts
export * from "./group.js";
export * from "./usage.js";
export * from "./artifacts.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/engine/test/artifacts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add resumable artifact store"
```

---

### Task 4: Repo tools (sandboxed read/grep/list)

**Files:**
- Create: `packages/engine/src/repo-fs.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/repo-fs.test.ts`

The pure filesystem functions are unit-tested; the `betaZodTool` wrappers (Task 6) stay thin.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/repo-fs.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/test/repo-fs.test.ts`
Expected: FAIL — `resolveInRepo` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/engine/src/repo-fs.ts`:
```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", ".authzscan"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|sql|prisma)$/;

export function resolveInRepo(repoRoot: string, rel: string): string {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, rel.replace(/\\/g, "/"));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`path escapes repo root: ${rel}`);
  }
  return abs;
}

export function readRepoFile(repoRoot: string, rel: string): string {
  const abs = resolveInRepo(repoRoot, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error(`file not found: ${rel}`);
  }
  const lines = readFileSync(abs, "utf8").split("\n");
  // Trailing empty element after final newline renders as a phantom line — drop it.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((l, i) => `${i + 1}\t${l}`).join("\n") + "\n";
}

export function listRepoFiles(repoRoot: string): string[] {
  const root = path.resolve(repoRoot);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (SOURCE_EXT.test(entry.name)) {
        out.push(path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

export function grepRepo(
  repoRoot: string,
  pattern: string,
  opts: { maxResults?: number } = {},
): GrepHit[] {
  const max = opts.maxResults ?? 100;
  const re = new RegExp(pattern);
  const hits: GrepHit[] = [];
  for (const file of listRepoFiles(repoRoot)) {
    const content = readFileSync(resolveInRepo(repoRoot, file), "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ file, line: i + 1, text: lines[i] });
        if (hits.length >= max) return hits;
      }
    }
  }
  return hits;
}
```

`packages/engine/src/index.ts`:
```ts
export * from "./group.js";
export * from "./usage.js";
export * from "./artifacts.js";
export * from "./repo-fs.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/engine/test/repo-fs.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add sandboxed repo filesystem helpers"
```

---

### Task 5: Prompts + JSON extraction

**Files:**
- Create: `packages/engine/src/prompts.ts`
- Create: `packages/engine/src/extract.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/prompts.test.ts`
- Test: `packages/engine/test/extract.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/prompts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, buildTracePrompt, buildVerifyPrompt } from "../src/index.js";
import type { TEndpoint, TAuthProfile, TCandidateFinding } from "@authzscan/shared";

const endpoint: TEndpoint = {
  id: "ep_orders",
  kind: "route-handler",
  file: "app/api/orders/[id]/route.ts",
  method: "GET",
  routePath: "/api/orders/[id]",
  params: ["id"],
  usesDb: true,
  authIndicators: ["getServerSession"],
};

const profile: TAuthProfile = {
  library: "next-auth",
  sessionAccessPatterns: ["getServerSession"],
  ownershipIdioms: ["{ id, userId: session.user.id }"],
};

const candidate: TCandidateFinding = {
  id: "f1",
  endpointId: "ep_orders",
  title: "t",
  description: "d",
  evidence: [{ file: "app/api/orders/[id]/route.ts", startLine: 1, endLine: 2, note: "n" }],
};

describe("prompts", () => {
  it("system prompt frames work as defensive code review", () => {
    expect(SYSTEM_PROMPT).toMatch(/defensive code review/i);
    expect(SYSTEM_PROMPT).not.toMatch(/exploit develop/i);
  });

  it("trace prompt is a stable snapshot", () => {
    expect(buildTracePrompt({ groupKey: "/api/orders", endpoints: [endpoint], authProfile: profile })).toMatchSnapshot();
  });

  it("verify prompt is a stable snapshot", () => {
    expect(buildVerifyPrompt({ candidate, authProfile: profile })).toMatchSnapshot();
  });

  it("trace prompt embeds endpoint data and repo auth idioms", () => {
    const p = buildTracePrompt({ groupKey: "/api/orders", endpoints: [endpoint], authProfile: profile });
    expect(p).toContain("app/api/orders/[id]/route.ts");
    expect(p).toContain("userId: session.user.id");
  });
});
```

`packages/engine/test/extract.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson } from "../src/index.js";

const Schema = z.array(z.object({ id: z.string() }));

describe("extractJson", () => {
  it("parses a fenced json block", () => {
    const text = 'Here you go:\n```json\n[{"id": "a"}]\n```\nDone.';
    expect(extractJson(text, Schema)).toEqual([{ id: "a" }]);
  });

  it("parses bare JSON output", () => {
    expect(extractJson('[{"id": "a"}]', Schema)).toEqual([{ id: "a" }]);
  });

  it("parses JSON embedded in prose via bracket scan", () => {
    const text = 'Findings below.\n[{"id": "a"}, {"id": "b"}]\nThat is all.';
    expect(extractJson(text, Schema)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("throws a descriptive error on invalid JSON", () => {
    expect(() => extractJson("no json here", Schema)).toThrow(/no JSON value found/i);
  });

  it("throws schema errors for valid JSON of the wrong shape", () => {
    expect(() => extractJson('[{"wrong": 1}]', Schema)).toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/prompts.test.ts packages/engine/test/extract.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write minimal implementation**

`packages/engine/src/prompts.ts`:
```ts
import type { TEndpoint, TAuthProfile, TCandidateFinding } from "@authzscan/shared";

// Defensive framing is load-bearing: Fable 5 routes some offensive-security
// prompts to a fallback model; code-review framing keeps us in the Fable lane.
export const SYSTEM_PROMPT = `You are an application security engineer performing defensive code review of a Next.js App Router codebase. Your sole focus is object-level authorization (IDOR/BOLA): finding database reads or writes keyed by a client-supplied identifier that lack an ownership or tenancy check, so the team can fix them.

You have tools to read files, grep, and list files in the repository under review. Evidence must cite real file paths and line numbers you actually read. Never invent code you have not seen. When asked for JSON, reply with JSON only — no prose around it.`;

export interface TracePromptInput {
  groupKey: string;
  endpoints: TEndpoint[];
  authProfile: TAuthProfile;
}

export function buildTracePrompt(input: TracePromptInput): string {
  return `Analyze the endpoint group "${input.groupKey}" for missing object-level authorization.

Repository auth context (how THIS repo does auth — judge endpoints against these idioms):
${JSON.stringify(input.authProfile, null, 2)}

Endpoints in this group:
${JSON.stringify(input.endpoints, null, 2)}

For each endpoint: read its file, trace every client-controlled identifier (route params, body fields, query params) to the database query it reaches, and decide whether the query is scoped to the requesting user/tenant. A query keyed only by the client-supplied id, with no ownership filter and no prior ownership check, is a candidate finding. Mutations (DELETE/PUT/PATCH/actions) deserve extra scrutiny — a check on GET does not protect its sibling DELETE.

Reply with ONLY a JSON array of candidate findings (empty array if none), each object exactly:
{
  "id": "<unique slug>",
  "endpointId": "<endpoint id from the list above>",
  "title": "<one line>",
  "description": "<what is fetched/mutated and what check is missing>",
  "evidence": [{ "file": "<repo-relative path>", "startLine": <int>, "endLine": <int>, "note": "<why this span matters>" }]
}`;
}

export interface VerifyPromptInput {
  candidate: TCandidateFinding;
  authProfile: TAuthProfile;
}

export function buildVerifyPrompt(input: VerifyPromptInput): string {
  return `You are now adversarially verifying a candidate IDOR finding produced by a previous reviewer. Your job is to kill false positives: re-read the cited code yourself and either prove the issue real with a concrete scenario, or reject it.

Repository auth context:
${JSON.stringify(input.authProfile, null, 2)}

Candidate finding:
${JSON.stringify(input.candidate, null, 2)}

Re-read the evidence files. Check for: middleware that already scopes the request, ownership checks earlier in the call chain, framework-level protections, and whether the identifier is truly client-controlled. Confirm ONLY if you can articulate a concrete unauthorized-access scenario (user A's session reaching user B's resource).

Reply with ONLY one JSON object exactly:
{
  "verdict": "confirmed" | "rejected",
  "confidence": "high" | "medium" | "low",
  "reproduction": "<concrete scenario, or why it was rejected>",
  "suggestedFix": "<minimal code change, or empty string if rejected>"
}`;
}
```

`packages/engine/src/extract.ts`:
```ts
import type { z } from "zod";

function candidates(text: string): string[] {
  const out: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) out.push(fenced[1].trim());
  out.push(text.trim());
  for (const open of ["[", "{"]) {
    const close = open === "[" ? "]" : "}";
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) out.push(text.slice(start, end + 1));
  }
  return out;
}

export function extractJson<T>(text: string, schema: z.ZodType<T>): T {
  let lastSchemaError: string | null = null;
  let sawJson = false;
  for (const c of candidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(c);
    } catch {
      continue;
    }
    sawJson = true;
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    lastSchemaError = result.error.message;
  }
  if (!sawJson) throw new Error("no JSON value found in agent output");
  throw new Error(`agent output JSON is invalid for the expected schema: ${lastSchemaError}`);
}
```

`packages/engine/src/index.ts`:
```ts
export * from "./group.js";
export * from "./usage.js";
export * from "./artifacts.js";
export * from "./repo-fs.js";
export * from "./prompts.js";
export * from "./extract.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/engine/test/prompts.test.ts packages/engine/test/extract.test.ts`
Expected: PASS (4 + 5 tests, 2 snapshots written).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add prompt builders and JSON extraction"
```

---

### Task 6: AgentRunner interface + Anthropic implementation

**Files:**
- Create: `packages/engine/src/runner.ts`
- Create: `packages/engine/src/anthropic-runner.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/runner.test.ts`

The interface and retry helper are fully unit-tested with fakes. `AnthropicRunner` itself is exercised by live runs (Plan 04 eval + manual smoke), not CI — its construction is kept thin and declarative for that reason.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/runner.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/index.js";

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to N times with backoff then succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("boom1"))
      .mockRejectedValueOnce(new Error("boom2"))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/test/runner.test.ts`
Expected: FAIL — `withRetry` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/engine/src/runner.ts`:
```ts
import type { TokenUsage } from "./usage.js";

export interface AgentRunResult {
  text: string;
  usage: TokenUsage;
}

export interface AgentRunRequest {
  system: string;
  prompt: string;
  repoRoot: string;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export interface RetryOptions {
  retries: number;
  delayMs: number;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.retries) {
        await new Promise((r) => setTimeout(r, opts.delayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
```

`packages/engine/src/anthropic-runner.ts`:
```ts
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
```

`packages/engine/src/index.ts`:
```ts
export * from "./group.js";
export * from "./usage.js";
export * from "./artifacts.js";
export * from "./repo-fs.js";
export * from "./prompts.js";
export * from "./extract.js";
export * from "./runner.js";
export * from "./anthropic-runner.js";
```

- [ ] **Step 4: Run test + typecheck to verify**

Run: `pnpm vitest run packages/engine/test/runner.test.ts` then `pnpm --filter @authzscan/engine exec tsc --noEmit`
Expected: tests PASS (3); typecheck clean. If the SDK's iteration shape differs from `for await (const message of runner)` (it is beta), check `node_modules/@anthropic-ai/sdk/helpers/beta/zod` typings and adjust — the contract to preserve is: accumulate usage across all iterations, return the last non-empty text.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add AgentRunner interface and Anthropic tool-runner implementation"
```

---

### Task 7: Trace phase

**Files:**
- Create: `packages/engine/src/trace.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/trace.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/trace.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runTracePhase, BudgetGuard } from "../src/index.js";
import type { AgentRunner } from "../src/index.js";
import type { TEndpoint, TAuthProfile } from "@authzscan/shared";

const profile: TAuthProfile = { library: "custom", sessionAccessPatterns: [], ownershipIdioms: [] };

function ep(id: string, key: string): TEndpoint {
  return {
    id,
    kind: "route-handler",
    file: `app${key}/route.ts`,
    method: "GET",
    routePath: key,
    params: ["id"],
    usesDb: true,
    authIndicators: [],
  };
}

const usage = { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 };

function candidateJson(id: string, endpointId: string): string {
  return JSON.stringify([
    {
      id,
      endpointId,
      title: "t",
      description: "d",
      evidence: [{ file: "app/x/route.ts", startLine: 1, endLine: 2, note: "n" }],
    },
  ]);
}

describe("runTracePhase", () => {
  it("collects validated candidates across groups", async () => {
    const runner: AgentRunner = {
      run: async ({ prompt }) => ({
        text: prompt.includes('"/api/a"') ? candidateJson("c1", "a1") : "[]",
        usage,
      }),
    };
    const result = await runTracePhase({
      endpoints: [ep("a1", "/api/a"), ep("b1", "/api/b")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.candidates.map((c) => c.id)).toEqual(["c1"]);
    expect(result.unscannedEndpointIds).toEqual([]);
  });

  it("re-prompts once on invalid output, then succeeds", async () => {
    let calls = 0;
    const runner: AgentRunner = {
      run: async () => {
        calls++;
        return { text: calls === 1 ? "garbage, no json" : candidateJson("c1", "a1"), usage };
      },
    };
    const result = await runTracePhase({
      endpoints: [ep("a1", "/api/a")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(calls).toBe(2);
    expect(result.candidates.map((c) => c.id)).toEqual(["c1"]);
  });

  it("marks group endpoints unscanned after persistent failure, scan continues", async () => {
    const runner: AgentRunner = {
      run: async ({ prompt }) => {
        if (prompt.includes('"/api/a"')) throw new Error("api down");
        return { text: candidateJson("c2", "b1"), usage };
      },
    };
    const result = await runTracePhase({
      endpoints: [ep("a1", "/api/a"), ep("b1", "/api/b")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 1, delayMs: 0 },
    });
    expect(result.unscannedEndpointIds).toEqual(["a1"]);
    expect(result.candidates.map((c) => c.id)).toEqual(["c2"]);
  });

  it("halts at budget cap, marking remaining groups unscanned", async () => {
    const bigUsage = { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0 }; // $5 on fable
    const runner: AgentRunner = { run: async () => ({ text: "[]", usage: bigUsage }) };
    const result = await runTracePhase({
      endpoints: [ep("a1", "/api/a"), ep("b1", "/api/b"), ep("c1", "/api/c")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(4, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    // First group spends $5 >= $4 budget → remaining two groups never run.
    expect(result.unscannedEndpointIds).toEqual(["b1", "c1"]);
    expect(result.budgetExceeded).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/test/trace.test.ts`
Expected: FAIL — `runTracePhase` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/engine/src/trace.ts`:
```ts
import { z } from "zod";
import { CandidateFinding, type TCandidateFinding, type TEndpoint, type TAuthProfile } from "@authzscan/shared";
import { groupEndpoints } from "./group.js";
import { buildTracePrompt, SYSTEM_PROMPT } from "./prompts.js";
import { extractJson } from "./extract.js";
import { withRetry, type AgentRunner, type RetryOptions } from "./runner.js";
import type { BudgetGuard } from "./usage.js";

const CandidateArray = z.array(CandidateFinding);

export interface TracePhaseInput {
  endpoints: TEndpoint[];
  authProfile: TAuthProfile;
  repoRoot: string;
  runner: AgentRunner;
  guard: BudgetGuard;
  retry: RetryOptions;
  log?: (message: string) => void;
}

export interface TracePhaseResult {
  candidates: TCandidateFinding[];
  unscannedEndpointIds: string[];
  budgetExceeded: boolean;
}

async function runOnce(
  input: TracePhaseInput,
  prompt: string,
): Promise<TCandidateFinding[]> {
  const result = await input.runner.run({ system: SYSTEM_PROMPT, prompt, repoRoot: input.repoRoot });
  input.guard.record(result.usage);
  try {
    return extractJson(result.text, CandidateArray);
  } catch (err) {
    // One re-prompt with the validation error, per spec. Then give up on the group.
    const correction = `${prompt}\n\nYour previous reply was not valid:\n${err instanceof Error ? err.message : String(err)}\nReply again with ONLY the JSON array, no other text.`;
    const second = await input.runner.run({ system: SYSTEM_PROMPT, prompt: correction, repoRoot: input.repoRoot });
    input.guard.record(second.usage);
    return extractJson(second.text, CandidateArray);
  }
}

export async function runTracePhase(input: TracePhaseInput): Promise<TracePhaseResult> {
  const groups = groupEndpoints(input.endpoints);
  const candidates: TCandidateFinding[] = [];
  const unscannedEndpointIds: string[] = [];
  let budgetExceeded = false;

  for (const group of groups) {
    if (input.guard.exceeded()) {
      budgetExceeded = true;
      unscannedEndpointIds.push(...group.endpoints.map((e) => e.id));
      continue;
    }
    const prompt = buildTracePrompt({ groupKey: group.key, endpoints: group.endpoints, authProfile: input.authProfile });
    try {
      const found = await withRetry(() => runOnce(input, prompt), input.retry);
      candidates.push(...found);
      input.log?.(`traced ${group.key}: ${found.length} candidate(s)`);
    } catch (err) {
      unscannedEndpointIds.push(...group.endpoints.map((e) => e.id));
      input.log?.(`trace FAILED for ${group.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { candidates, unscannedEndpointIds, budgetExceeded };
}
```

`packages/engine/src/index.ts`: append
```ts
export * from "./trace.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/engine/test/trace.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add trace phase orchestration"
```

---

### Task 8: Verify phase

**Files:**
- Create: `packages/engine/src/verify.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/verify.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/verify.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runVerifyPhase, BudgetGuard } from "../src/index.js";
import type { AgentRunner } from "../src/index.js";
import type { TCandidateFinding, TAuthProfile } from "@authzscan/shared";

const profile: TAuthProfile = { library: "custom", sessionAccessPatterns: [], ownershipIdioms: [] };
const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 };

function candidate(id: string): TCandidateFinding {
  return {
    id,
    endpointId: "ep1",
    title: "t",
    description: "d",
    evidence: [{ file: "a.ts", startLine: 1, endLine: 2, note: "n" }],
  };
}

const verdictJson = (verdict: string, confidence = "high") =>
  JSON.stringify({ verdict, confidence, reproduction: "repro", suggestedFix: "fix" });

describe("runVerifyPhase", () => {
  it("merges verdicts onto candidates", async () => {
    const runner: AgentRunner = {
      run: async ({ prompt }) => ({
        text: prompt.includes('"c1"') ? verdictJson("confirmed") : verdictJson("rejected", "low"),
        usage,
      }),
    };
    const result = await runVerifyPhase({
      candidates: [candidate("c1"), candidate("c2")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.findings.map((f) => [f.id, f.verdict])).toEqual([
      ["c1", "confirmed"],
      ["c2", "rejected"],
    ]);
  });

  it("degrades loudly on verify failure: kept as low-confidence confirmed with explicit note", async () => {
    const runner: AgentRunner = {
      run: async () => {
        throw new Error("api down");
      },
    };
    const result = await runVerifyPhase({
      candidates: [candidate("c1")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(undefined, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].verdict).toBe("confirmed");
    expect(result.findings[0].confidence).toBe("low");
    expect(result.findings[0].reproduction).toMatch(/verification failed/i);
  });

  it("stops verifying at budget cap; remaining candidates marked unverified", async () => {
    const bigUsage = { inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const runner: AgentRunner = { run: async () => ({ text: verdictJson("confirmed"), usage: bigUsage }) };
    const result = await runVerifyPhase({
      candidates: [candidate("c1"), candidate("c2")],
      authProfile: profile,
      repoRoot: "/repo",
      runner,
      guard: new BudgetGuard(4, "claude-fable-5"),
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.findings[0].verdict).toBe("confirmed");
    expect(result.findings[1].confidence).toBe("low");
    expect(result.findings[1].reproduction).toMatch(/budget/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/test/verify.test.ts`
Expected: FAIL — `runVerifyPhase` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/engine/src/verify.ts`:
```ts
import { z } from "zod";
import { Confidence, type TCandidateFinding, type TFinding, type TAuthProfile } from "@authzscan/shared";
import { buildVerifyPrompt, SYSTEM_PROMPT } from "./prompts.js";
import { extractJson } from "./extract.js";
import { withRetry, type AgentRunner, type RetryOptions } from "./runner.js";
import type { BudgetGuard } from "./usage.js";

const Verdict = z.object({
  verdict: z.enum(["confirmed", "rejected"]),
  confidence: Confidence,
  reproduction: z.string(),
  suggestedFix: z.string(),
});

export interface VerifyPhaseInput {
  candidates: TCandidateFinding[];
  authProfile: TAuthProfile;
  repoRoot: string;
  runner: AgentRunner;
  guard: BudgetGuard;
  retry: RetryOptions;
  log?: (message: string) => void;
}

export interface VerifyPhaseResult {
  findings: TFinding[];
  budgetExceeded: boolean;
}

// Degrade loudly: a candidate we could not verify is reported, not dropped —
// a false "clean" is worse than a noisy report.
function unverified(candidate: TCandidateFinding, reason: string): TFinding {
  return {
    ...candidate,
    verdict: "confirmed",
    confidence: "low",
    reproduction: `UNVERIFIED — verification failed: ${reason}. Treat as an unreviewed candidate, not a confirmed vulnerability.`,
    suggestedFix: "",
  };
}

export async function runVerifyPhase(input: VerifyPhaseInput): Promise<VerifyPhaseResult> {
  const findings: TFinding[] = [];
  let budgetExceeded = false;

  for (const candidate of input.candidates) {
    if (input.guard.exceeded()) {
      budgetExceeded = true;
      findings.push(unverified(candidate, "scan budget exhausted before this candidate was verified"));
      continue;
    }
    const prompt = buildVerifyPrompt({ candidate, authProfile: input.authProfile });
    try {
      const verdict = await withRetry(async () => {
        const result = await input.runner.run({ system: SYSTEM_PROMPT, prompt, repoRoot: input.repoRoot });
        input.guard.record(result.usage);
        return extractJson(result.text, Verdict);
      }, input.retry);
      findings.push({ ...candidate, ...verdict });
      input.log?.(`verified ${candidate.id}: ${verdict.verdict} (${verdict.confidence})`);
    } catch (err) {
      findings.push(unverified(candidate, err instanceof Error ? err.message : String(err)));
      input.log?.(`verify FAILED for ${candidate.id}`);
    }
  }

  return { findings, budgetExceeded };
}
```

`packages/engine/src/index.ts`: append
```ts
export * from "./verify.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/engine/test/verify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add adversarial verify phase"
```

---

### Task 9: Scan pipeline (inventory → trace → verify → render)

**Files:**
- Create: `packages/engine/src/scan.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/scan.test.ts`

- [ ] **Step 1: Write the failing test**

The test uses the Plan 02 fixture repo as scan target (real inventory, fake runner).

`packages/engine/test/scan.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeScan } from "../src/index.js";
import type { AgentRunner } from "../src/index.js";

const fixtureSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "inventory", "test", "fixtures", "basic-app",
);

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "authzscan-scan-"));
  cpSync(fixtureSrc, repo, { recursive: true });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 };

const traceReply = JSON.stringify([
  {
    id: "f_orders_get",
    endpointId: "ep_app_api_orders_id_route_ts_get",
    title: "Order fetched without ownership check",
    description: "findUnique keyed only on id",
    evidence: [{ file: "app/api/orders/[id]/route.ts", startLine: 6, endLine: 8, note: "no userId" }],
  },
]);
const verifyReply = JSON.stringify({
  verdict: "confirmed",
  confidence: "high",
  reproduction: "user A fetches user B's order id",
  suggestedFix: "scope where clause by session user id",
});

function fakeRunner(): AgentRunner {
  return {
    run: async ({ prompt }) => ({
      text: prompt.includes("adversarially verifying") ? verifyReply : prompt.includes("/api/orders") ? traceReply : "[]",
      usage,
    }),
  };
}

describe("executeScan", () => {
  it("runs end-to-end and reports coverage + findings", async () => {
    const result = await executeScan({
      repoPath: repo,
      runner: fakeRunner(),
      model: "claude-fable-5",
      retry: { retries: 0, delayMs: 0 },
    });
    expect(result.findings.map((f) => f.verdict)).toEqual(["confirmed"]);
    expect(result.coverage.total).toBe(4);
    expect(result.coverage.analyzed).toBe(4);
    expect(result.reportMarkdown).toContain("Order fetched without ownership check");
    expect(result.sarif.runs[0].results).toHaveLength(1);
  });

  it("writes resumable artifacts to .authzscan/", async () => {
    await executeScan({ repoPath: repo, runner: fakeRunner(), model: "claude-fable-5", retry: { retries: 0, delayMs: 0 } });
    for (const name of ["inventory.json", "candidates.json", "findings.json"]) {
      expect(existsSync(path.join(repo, ".authzscan", name))).toBe(true);
    }
  });

  it("resume skips completed phases (runner never called)", async () => {
    await executeScan({ repoPath: repo, runner: fakeRunner(), model: "claude-fable-5", retry: { retries: 0, delayMs: 0 } });
    let calls = 0;
    const countingRunner: AgentRunner = {
      run: async () => {
        calls++;
        return { text: "[]", usage };
      },
    };
    const result = await executeScan({
      repoPath: repo,
      runner: countingRunner,
      model: "claude-fable-5",
      retry: { retries: 0, delayMs: 0 },
      resume: true,
    });
    expect(calls).toBe(0);
    expect(result.findings).toHaveLength(1);
  });

  it("writes report.md and results.sarif into .authzscan/", async () => {
    await executeScan({ repoPath: repo, runner: fakeRunner(), model: "claude-fable-5", retry: { retries: 0, delayMs: 0 } });
    const report = readFileSync(path.join(repo, ".authzscan", "report.md"), "utf8");
    expect(report).toContain("# authzscan report");
    const sarif = JSON.parse(readFileSync(path.join(repo, ".authzscan", "results.sarif"), "utf8"));
    expect(sarif.version).toBe("2.1.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/test/scan.test.ts`
Expected: FAIL — `executeScan` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/engine/src/scan.ts`:
```ts
import { writeFileSync } from "node:fs";
import { z } from "zod";
import {
  InventoryResult,
  CandidateFinding,
  Finding,
  renderReport,
  toSarif,
  sortFindings,
  type TFinding,
  type TInventoryResult,
  type SarifLog,
} from "@authzscan/shared";
import { runInventory } from "@authzscan/inventory";
import { ArtifactStore } from "./artifacts.js";
import { BudgetGuard, type TokenUsage } from "./usage.js";
import { runTracePhase } from "./trace.js";
import { runVerifyPhase } from "./verify.js";
import type { AgentRunner, RetryOptions } from "./runner.js";

const CandidatesArtifact = z.object({ candidates: z.array(CandidateFinding), unscannedEndpointIds: z.array(z.string()) });
const FindingsArtifact = z.object({ findings: z.array(Finding), unscannedEndpointIds: z.array(z.string()) });

export interface ScanOptions {
  repoPath: string;
  runner: AgentRunner;
  model: string;
  retry: RetryOptions;
  budgetUsd?: number;
  maxEndpoints?: number;
  resume?: boolean;
  log?: (message: string) => void;
}

export interface ScanResult {
  findings: TFinding[];
  coverage: { analyzed: number; total: number; unscanned: string[] };
  reportMarkdown: string;
  sarif: SarifLog;
  spentUsd: number;
  totalUsage: TokenUsage;
}

export async function executeScan(opts: ScanOptions): Promise<ScanResult> {
  const store = new ArtifactStore(opts.repoPath);
  const guard = new BudgetGuard(opts.budgetUsd, opts.model);

  // Phase 1: inventory (deterministic; cheap to redo, but resume keeps it byte-stable)
  let inventory: TInventoryResult | null = opts.resume ? store.read("inventory", InventoryResult) : null;
  if (!inventory) {
    inventory = runInventory(opts.repoPath);
    store.write("inventory", inventory);
  }
  let endpoints = inventory.endpoints;
  if (opts.maxEndpoints !== undefined) endpoints = endpoints.slice(0, opts.maxEndpoints);
  opts.log?.(`inventory: ${endpoints.length} endpoint(s), auth library ${inventory.authProfile.library}`);

  // Phase 2: trace
  let traceData = opts.resume ? store.read("candidates", CandidatesArtifact) : null;
  if (!traceData) {
    const trace = await runTracePhase({
      endpoints,
      authProfile: inventory.authProfile,
      repoRoot: opts.repoPath,
      runner: opts.runner,
      guard,
      retry: opts.retry,
      log: opts.log,
    });
    traceData = { candidates: trace.candidates, unscannedEndpointIds: trace.unscannedEndpointIds };
    store.write("candidates", traceData);
  }

  // Phase 3: verify
  let verifyData = opts.resume ? store.read("findings", FindingsArtifact) : null;
  if (!verifyData) {
    const verify = await runVerifyPhase({
      candidates: traceData.candidates,
      authProfile: inventory.authProfile,
      repoRoot: opts.repoPath,
      runner: opts.runner,
      guard,
      retry: opts.retry,
      log: opts.log,
    });
    verifyData = { findings: verify.findings, unscannedEndpointIds: traceData.unscannedEndpointIds };
    store.write("findings", verifyData);
  }

  // Phase 4: render
  const findings = sortFindings(verifyData.findings);
  const unscanned = verifyData.unscannedEndpointIds;
  const coverage = {
    analyzed: endpoints.length - unscanned.length,
    total: endpoints.length,
    unscanned,
  };
  const reportMarkdown = renderReport({
    repoPath: opts.repoPath,
    generatedAt: new Date().toISOString(),
    coverage,
    findings,
  });
  const sarif = toSarif(findings, { toolVersion: "0.1.0" });

  writeFileSync(store.path("inventory").replace(/inventory\.json$/, "report.md"), reportMarkdown, "utf8");
  writeFileSync(store.path("inventory").replace(/inventory\.json$/, "results.sarif"), JSON.stringify(sarif, null, 2), "utf8");

  return { findings, coverage, reportMarkdown, sarif, spentUsd: guard.spentUsd(), totalUsage: guard.total() };
}
```

`packages/engine/src/index.ts`: append
```ts
export * from "./scan.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/engine/test/scan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add end-to-end scan pipeline with resume and rendering"
```

---

### Task 10: CLI wiring + full verification

**Files:**
- Modify: `packages/cli/package.json` (add engine dep)
- Modify: `packages/cli/src/bin.ts`
- Create: `packages/cli/src/run-scan.ts`
- Test: `packages/cli/test/run-scan.test.ts`

- [ ] **Step 1: Add the engine dependency**

In `packages/cli/package.json`, add to `dependencies`:
```json
"@authzscan/engine": "workspace:*"
```
Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/cli/test/run-scan.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildScanSummary } from "../src/run-scan.js";
import { EXIT } from "../src/exit-code.js";
import type { TFinding } from "@authzscan/shared";

const finding: TFinding = {
  id: "f1",
  endpointId: "ep1",
  title: "t",
  description: "d",
  evidence: [{ file: "a.ts", startLine: 1, endLine: 2, note: "n" }],
  verdict: "confirmed",
  confidence: "high",
  reproduction: "r",
  suggestedFix: "s",
};

describe("buildScanSummary", () => {
  it("summarizes a dirty scan with exit code 1", () => {
    const s = buildScanSummary({
      findings: [finding],
      coverage: { analyzed: 4, total: 4, unscanned: [] },
      spentUsd: 1.23,
    });
    expect(s.exitCode).toBe(EXIT.FINDINGS);
    expect(s.text).toContain("1 confirmed finding");
    expect(s.text).toContain("4/4 endpoints analyzed");
    expect(s.text).toContain("$1.23");
  });

  it("summarizes a clean scan with exit code 0", () => {
    const s = buildScanSummary({
      findings: [{ ...finding, verdict: "rejected" }],
      coverage: { analyzed: 4, total: 4, unscanned: [] },
      spentUsd: 0.5,
    });
    expect(s.exitCode).toBe(EXIT.CLEAN);
    expect(s.text).toContain("No confirmed findings");
  });

  it("warns loudly when coverage is partial", () => {
    const s = buildScanSummary({
      findings: [],
      coverage: { analyzed: 2, total: 4, unscanned: ["a", "b"] },
      spentUsd: 0,
    });
    expect(s.text).toMatch(/2 endpoint\(s\) NOT analyzed/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/test/run-scan.test.ts`
Expected: FAIL — cannot resolve `../src/run-scan.js`.

- [ ] **Step 4: Write minimal implementation**

`packages/cli/src/run-scan.ts`:
```ts
import { writeFileSync } from "node:fs";
import { executeScan, AnthropicRunner, type ScanResult } from "@authzscan/engine";
import type { TFinding } from "@authzscan/shared";
import { EXIT, exitCodeForFindings, type ExitCode } from "./exit-code.js";
import type { ScanOptions } from "./program.js";

export interface ScanSummaryInput {
  findings: TFinding[];
  coverage: { analyzed: number; total: number; unscanned: string[] };
  spentUsd: number;
}

export interface ScanSummary {
  text: string;
  exitCode: ExitCode;
}

export function buildScanSummary(input: ScanSummaryInput): ScanSummary {
  const confirmed = input.findings.filter((f) => f.verdict === "confirmed");
  const lines = [
    `authzscan: ${input.coverage.analyzed}/${input.coverage.total} endpoints analyzed`,
  ];
  const missed = input.coverage.total - input.coverage.analyzed;
  if (missed > 0) {
    lines.push(`WARNING: ${missed} endpoint(s) NOT analyzed — this is not a clean bill for them.`);
  }
  lines.push(
    confirmed.length === 0
      ? "No confirmed findings."
      : `${confirmed.length} confirmed finding${confirmed.length === 1 ? "" : "s"}.`,
  );
  lines.push(`Estimated spend: $${input.spentUsd.toFixed(2)}`);
  lines.push("Report: .authzscan/report.md  SARIF: .authzscan/results.sarif");
  return { text: lines.join("\n"), exitCode: exitCodeForFindings(input.findings) };
}

export async function runScanCommand(repo: string, opts: ScanOptions): Promise<never> {
  let result: ScanResult;
  try {
    result = await executeScan({
      repoPath: repo,
      runner: new AnthropicRunner({ model: opts.model }),
      model: opts.model,
      retry: { retries: 2, delayMs: 1000 },
      budgetUsd: opts.budget,
      maxEndpoints: opts.maxEndpoints,
      resume: opts.resume,
      log: (m) => console.error(`[authzscan] ${m}`),
    });
  } catch (err) {
    console.error(`authzscan: scan failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.ERROR);
  }

  if (opts.format === "json") {
    console.log(JSON.stringify({ findings: result.findings, coverage: result.coverage }, null, 2));
  } else if (opts.format === "sarif") {
    console.log(JSON.stringify(result.sarif, null, 2));
  } else {
    console.log(result.reportMarkdown);
  }

  const summary = buildScanSummary(result);
  console.error(summary.text);
  process.exit(summary.exitCode);
}
```

`packages/cli/src/bin.ts` (replace stub):
```ts
#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { runScanCommand } from "./run-scan.js";

const program = buildProgram((repo, opts) => {
  void runScanCommand(repo, opts);
});

program.parse();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/test/run-scan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full-suite verification**

Run: `pnpm test` then `pnpm typecheck`
Expected: all suites green (Plan 01+02's 67 tests + engine ~31 + cli 3 ≈ 101), typecheck clean.

- [ ] **Step 7: Manual live smoke (optional, needs ANTHROPIC_API_KEY, costs real money)**

NOT part of CI. With a key set:
```bash
pnpm --filter @authzscan/cli exec tsx src/bin.ts scan ../../packages/inventory/test/fixtures/basic-app --budget 2
```
Expected: scan runs against the fixture, finds the unscoped `findUnique`/`delete` on orders, exits 1, `.authzscan/report.md` written. If the cybersec classifier reroutes (response quality oddly low), note it — prompts are framed as defensive review to minimize this.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(cli): wire scan command to engine pipeline"
```

---

## Spec coverage map (Plan 03 slice)

| Spec requirement | Task |
|---|---|
| Endpoints grouped by resource | 1 |
| Budget flag, usage tracking, clean halt with partial results | 2, 7, 8 |
| `.authzscan/` artifacts + `--resume` | 3, 9 |
| Agent tools scoped to repo (read/grep) | 4, 6 |
| Defensive-review framing (classifier mitigation) | 5 |
| Malformed output: zod-validate, one re-prompt, then unscanned | 5, 7 |
| Trace phase per group, evidence chains | 7 |
| Verify phase, fresh agent per candidate, independent judgment | 8 |
| Retry 2x exponential backoff; failed group → unscanned, scan continues | 6, 7 |
| Coverage stated explicitly ("44/47 analyzed") | 9, 10 |
| MD + SARIF + exit codes end-to-end | 9, 10 |
| Fable 5 default, `--model` fallback | 6, 10 |
| Middleware awareness (deferred from Plan 02) | 5 — verify prompt instructs re-checking middleware; auth profile feeds both prompts |

Notes: verify-failure handling refines the spec — an unverifiable candidate is *reported* as low-confidence UNVERIFIED rather than dropped (degrade loudly). Engine surface is `@anthropic-ai/sdk` tool runner (deviation flagged in header). Live-LLM behavior is validated by Plan 04's eval harness, not CI.
