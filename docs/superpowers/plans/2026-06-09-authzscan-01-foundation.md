# authzscan Plan 01: Foundation (monorepo + shared + CLI skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working pnpm monorepo with the `@authzscan/shared` package (finding/endpoint schemas, SARIF serializer, Markdown report renderer, confidence model) and a `@authzscan/cli` skeleton with exit-code contract — all unit-tested.

**Architecture:** pnpm workspace, ESM TypeScript throughout, vitest at root. `shared` holds all cross-package types as zod schemas (runtime validation is a spec requirement — every agent output gets zod-validated later). CLI wires commander to a stubbed scan handler; engine integration comes in Plan 03.

**Tech Stack:** pnpm, TypeScript 5 (NodeNext ESM), zod 4, vitest 3, commander 14.

**Plan series (spec → 4 plans):** 01 foundation (this) → 02 inventory parser → 03 engine + CLI integration → 04 benchmark + eval harness.

**Spec:** `docs/superpowers/specs/2026-06-09-authzscan-mvp-design.md`

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.npmrc`

- [ ] **Step 1: Create workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`package.json`:
```json
{
  "name": "authzscan-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "pnpm -r exec tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
```

`.gitignore`:
```
node_modules/
dist/
coverage/
.authzscan/
*.tsbuildinfo
```

`.npmrc`:
```
engine-strict=true
```

- [ ] **Step 2: Install and verify empty test run passes**

Run: `pnpm install` then `pnpm test`
Expected: vitest exits 0 with "No test files found" (passWithNoTests).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with vitest + typescript"
```

---

### Task 2: shared package — Endpoint + AuthProfile + InventoryResult schemas

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/endpoint.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/test/endpoint.test.ts`

- [ ] **Step 1: Create package scaffold**

`packages/shared/package.json`:
```json
{
  "name": "@authzscan/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/shared/test/endpoint.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Endpoint, AuthProfile, InventoryResult } from "../src/index.js";

const validEndpoint = {
  id: "ep_orders_id_get",
  kind: "route-handler",
  file: "app/api/orders/[id]/route.ts",
  method: "GET",
  routePath: "/api/orders/[id]",
  params: ["id"],
  usesDb: true,
  authIndicators: ["getServerSession"],
};

describe("Endpoint schema", () => {
  it("accepts a valid route handler", () => {
    expect(Endpoint.parse(validEndpoint)).toEqual(validEndpoint);
  });

  it("accepts a server action with null method and routePath", () => {
    const action = {
      ...validEndpoint,
      id: "ep_delete_order_action",
      kind: "server-action",
      file: "app/orders/actions.ts",
      method: null,
      routePath: null,
      params: [],
    };
    expect(Endpoint.parse(action)).toEqual(action);
  });

  it("rejects unknown kind", () => {
    expect(() => Endpoint.parse({ ...validEndpoint, kind: "page" })).toThrow();
  });

  it("rejects unknown HTTP method", () => {
    expect(() => Endpoint.parse({ ...validEndpoint, method: "FETCH" })).toThrow();
  });
});

describe("AuthProfile schema", () => {
  it("accepts a known library profile", () => {
    const profile = {
      library: "next-auth",
      sessionAccessPatterns: ["getServerSession(authOptions)"],
      ownershipIdioms: ["where: { id, userId: session.user.id }"],
    };
    expect(AuthProfile.parse(profile)).toEqual(profile);
  });

  it("rejects unlisted library", () => {
    expect(() =>
      AuthProfile.parse({ library: "passport", sessionAccessPatterns: [], ownershipIdioms: [] }),
    ).toThrow();
  });
});

describe("InventoryResult schema", () => {
  it("accepts endpoints + profile + skipped files", () => {
    const result = {
      endpoints: [validEndpoint],
      authProfile: { library: "custom", sessionAccessPatterns: [], ownershipIdioms: [] },
      skippedFiles: [{ file: "app/api/legacy/route.ts", reason: "parse error: unexpected token" }],
    };
    expect(InventoryResult.parse(result)).toEqual(result);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/test/endpoint.test.ts`
Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 4: Write minimal implementation**

`packages/shared/src/endpoint.ts`:
```ts
import { z } from "zod";

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export const Endpoint = z.object({
  id: z.string().min(1),
  kind: z.enum(["route-handler", "server-action"]),
  file: z.string().min(1),
  method: HttpMethod.nullable(),
  routePath: z.string().nullable(),
  params: z.array(z.string()),
  usesDb: z.boolean(),
  authIndicators: z.array(z.string()),
});

export const AuthProfile = z.object({
  library: z.enum(["next-auth", "clerk", "lucia", "custom", "unknown"]),
  sessionAccessPatterns: z.array(z.string()),
  ownershipIdioms: z.array(z.string()),
});

export const InventoryResult = z.object({
  endpoints: z.array(Endpoint),
  authProfile: AuthProfile,
  skippedFiles: z.array(z.object({ file: z.string(), reason: z.string() })),
});

export type THttpMethod = z.infer<typeof HttpMethod>;
export type TEndpoint = z.infer<typeof Endpoint>;
export type TAuthProfile = z.infer<typeof AuthProfile>;
export type TInventoryResult = z.infer<typeof InventoryResult>;
```

`packages/shared/src/index.ts`:
```ts
export * from "./endpoint.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/test/endpoint.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add Endpoint, AuthProfile, InventoryResult schemas"
```

---

### Task 3: shared package — Finding schemas + confidence model

**Files:**
- Create: `packages/shared/src/finding.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/finding.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/test/finding.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CandidateFinding, Finding, sortFindings, type TFinding } from "../src/index.js";

const candidate = {
  id: "f_orders_id_get_1",
  endpointId: "ep_orders_id_get",
  title: "Order fetched by id without ownership check",
  description: "GET /api/orders/[id] loads prisma.order.findUnique({ where: { id } }) with no userId filter.",
  evidence: [
    {
      file: "app/api/orders/[id]/route.ts",
      startLine: 12,
      endLine: 18,
      note: "findUnique keyed only on params.id",
    },
  ],
};

const confirmed: TFinding = {
  ...candidate,
  verdict: "confirmed",
  confidence: "high",
  reproduction: "As user A (session cookie A), GET /api/orders/<order-id-of-user-B> returns user B's order.",
  suggestedFix: "Add userId to the where clause: prisma.order.findUnique({ where: { id, userId: session.user.id } }).",
};

describe("CandidateFinding schema", () => {
  it("accepts a valid candidate", () => {
    expect(CandidateFinding.parse(candidate)).toEqual(candidate);
  });

  it("rejects empty evidence", () => {
    expect(() => CandidateFinding.parse({ ...candidate, evidence: [] })).toThrow();
  });
});

describe("Finding schema", () => {
  it("accepts a confirmed finding", () => {
    expect(Finding.parse(confirmed)).toEqual(confirmed);
  });

  it("rejects invalid confidence", () => {
    expect(() => Finding.parse({ ...confirmed, confidence: "certain" })).toThrow();
  });
});

describe("sortFindings", () => {
  it("orders high > medium > low and does not mutate input", () => {
    const low: TFinding = { ...confirmed, id: "f_low", confidence: "low" };
    const med: TFinding = { ...confirmed, id: "f_med", confidence: "medium" };
    const input = [low, med, confirmed];
    const sorted = sortFindings(input);
    expect(sorted.map((f) => f.id)).toEqual(["f_orders_id_get_1", "f_med", "f_low"]);
    expect(input.map((f) => f.id)).toEqual(["f_low", "f_med", "f_orders_id_get_1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/test/finding.test.ts`
Expected: FAIL — `CandidateFinding` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/finding.ts`:
```ts
import { z } from "zod";

export const Confidence = z.enum(["high", "medium", "low"]);

export const Evidence = z.object({
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  note: z.string(),
});

export const CandidateFinding = z.object({
  id: z.string().min(1),
  endpointId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  evidence: z.array(Evidence).min(1),
});

export const Finding = CandidateFinding.extend({
  verdict: z.enum(["confirmed", "rejected"]),
  confidence: Confidence,
  reproduction: z.string(),
  suggestedFix: z.string(),
});

export type TConfidence = z.infer<typeof Confidence>;
export type TEvidence = z.infer<typeof Evidence>;
export type TCandidateFinding = z.infer<typeof CandidateFinding>;
export type TFinding = z.infer<typeof Finding>;

const confidenceRank: Record<TConfidence, number> = { high: 3, medium: 2, low: 1 };

export function sortFindings(findings: TFinding[]): TFinding[] {
  return [...findings].sort(
    (a, b) => confidenceRank[b.confidence] - confidenceRank[a.confidence],
  );
}
```

`packages/shared/src/index.ts`:
```ts
export * from "./endpoint.js";
export * from "./finding.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/test/finding.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add CandidateFinding/Finding schemas and confidence sort"
```

---

### Task 4: shared package — SARIF 2.1.0 serializer

**Files:**
- Create: `packages/shared/src/sarif.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/sarif.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/test/sarif.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toSarif, type TFinding } from "../src/index.js";

function finding(overrides: Partial<TFinding> = {}): TFinding {
  return {
    id: "f1",
    endpointId: "ep1",
    title: "Order fetched without ownership check",
    description: "findUnique keyed only on id.",
    evidence: [
      { file: "app/api/orders/[id]/route.ts", startLine: 12, endLine: 18, note: "no userId filter" },
    ],
    verdict: "confirmed",
    confidence: "high",
    reproduction: "GET other user's order id with own session.",
    suggestedFix: "Scope query by session.user.id.",
    ...overrides,
  };
}

describe("toSarif", () => {
  it("emits required SARIF 2.1.0 envelope", () => {
    const log = toSarif([finding()], { toolVersion: "0.1.0" });
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe("authzscan");
    expect(log.runs[0].tool.driver.version).toBe("0.1.0");
    expect(log.runs[0].tool.driver.rules).toEqual([
      expect.objectContaining({ id: "authzscan/idor" }),
    ]);
  });

  it("maps confidence to level: high=error, medium=warning, low=note", () => {
    const log = toSarif(
      [finding({ id: "a", confidence: "high" }), finding({ id: "b", confidence: "medium" }), finding({ id: "c", confidence: "low" })],
      { toolVersion: "0.1.0" },
    );
    expect(log.runs[0].results.map((r) => r.level)).toEqual(["error", "warning", "note"]);
  });

  it("excludes rejected findings", () => {
    const log = toSarif([finding({ verdict: "rejected" })], { toolVersion: "0.1.0" });
    expect(log.runs[0].results).toHaveLength(0);
  });

  it("maps evidence to physical locations", () => {
    const log = toSarif([finding()], { toolVersion: "0.1.0" });
    expect(log.runs[0].results[0].locations).toEqual([
      {
        physicalLocation: {
          artifactLocation: { uri: "app/api/orders/[id]/route.ts" },
          region: { startLine: 12, endLine: 18 },
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/test/sarif.test.ts`
Expected: FAIL — `toSarif` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/sarif.ts`:
```ts
import type { TConfidence, TFinding } from "./finding.js";

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { startLine: number; endLine: number };
  };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: SarifLocation[];
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: Array<{ id: string; shortDescription: { text: string } }>;
      };
    };
    results: SarifResult[];
  }>;
}

const RULE_ID = "authzscan/idor";

const levelByConfidence: Record<TConfidence, SarifResult["level"]> = {
  high: "error",
  medium: "warning",
  low: "note",
};

export function toSarif(findings: TFinding[], opts: { toolVersion: string }): SarifLog {
  const confirmed = findings.filter((f) => f.verdict === "confirmed");
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "authzscan",
            version: opts.toolVersion,
            informationUri: "https://github.com/davidldv/authzscan",
            rules: [
              {
                id: RULE_ID,
                shortDescription: { text: "Object-level authorization missing (IDOR/BOLA)" },
              },
            ],
          },
        },
        results: confirmed.map((f) => ({
          ruleId: RULE_ID,
          level: levelByConfidence[f.confidence],
          message: { text: `${f.title}\n\n${f.description}\n\nReproduction: ${f.reproduction}` },
          locations: f.evidence.map((e) => ({
            physicalLocation: {
              artifactLocation: { uri: e.file },
              region: { startLine: e.startLine, endLine: e.endLine },
            },
          })),
        })),
      },
    ],
  };
}
```

`packages/shared/src/index.ts`:
```ts
export * from "./endpoint.js";
export * from "./finding.js";
export * from "./sarif.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/test/sarif.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add SARIF 2.1.0 serializer"
```

---

### Task 5: shared package — Markdown report renderer

**Files:**
- Create: `packages/shared/src/report.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/report.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/test/report.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderReport, type TFinding } from "../src/index.js";

const confirmed: TFinding = {
  id: "f1",
  endpointId: "ep1",
  title: "Order fetched without ownership check",
  description: "findUnique keyed only on id.",
  evidence: [
    { file: "app/api/orders/[id]/route.ts", startLine: 12, endLine: 18, note: "no userId filter" },
  ],
  verdict: "confirmed",
  confidence: "high",
  reproduction: "GET other user's order id with own session.",
  suggestedFix: "Scope query by session.user.id.",
};

const input = {
  repoPath: "C:/Users/Alejandro/Dev/labodega",
  generatedAt: "2026-06-09T12:00:00Z",
  coverage: { analyzed: 44, total: 47, unscanned: ["ep_x", "ep_y", "ep_z"] },
  findings: [confirmed, { ...confirmed, id: "f2", verdict: "rejected" as const }],
};

describe("renderReport", () => {
  it("renders deterministic markdown snapshot", () => {
    expect(renderReport(input)).toMatchSnapshot();
  });

  it("states coverage explicitly", () => {
    const md = renderReport(input);
    expect(md).toContain("44/47 endpoints analyzed");
    expect(md).toContain("3 not scanned");
  });

  it("counts only confirmed findings in summary", () => {
    const md = renderReport(input);
    expect(md).toContain("1 confirmed finding");
  });

  it("reports clean when nothing confirmed", () => {
    const md = renderReport({ ...input, findings: [] });
    expect(md).toContain("No confirmed findings");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/test/report.test.ts`
Expected: FAIL — `renderReport` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/report.ts`:
```ts
import { sortFindings, type TFinding } from "./finding.js";

export interface ReportInput {
  repoPath: string;
  generatedAt: string;
  coverage: { analyzed: number; total: number; unscanned: string[] };
  findings: TFinding[];
}

export function renderReport(input: ReportInput): string {
  const confirmed = sortFindings(input.findings.filter((f) => f.verdict === "confirmed"));
  const { analyzed, total, unscanned } = input.coverage;

  const lines: string[] = [
    "# authzscan report",
    "",
    `- **Repo:** ${input.repoPath}`,
    `- **Generated:** ${input.generatedAt}`,
    `- **Coverage:** ${analyzed}/${total} endpoints analyzed, ${unscanned.length} not scanned`,
    `- **Result:** ${
      confirmed.length === 0
        ? "No confirmed findings"
        : `${confirmed.length} confirmed finding${confirmed.length === 1 ? "" : "s"}`
    }`,
    "",
  ];

  if (unscanned.length > 0) {
    lines.push("## Unscanned endpoints", "");
    lines.push("These endpoints were NOT analyzed. Do not treat this report as a clean bill for them.", "");
    for (const id of unscanned) lines.push(`- \`${id}\``);
    lines.push("");
  }

  for (const f of confirmed) {
    lines.push(`## [${f.confidence.toUpperCase()}] ${f.title}`, "");
    lines.push(f.description, "");
    lines.push("**Evidence:**", "");
    for (const e of f.evidence) {
      lines.push(`- \`${e.file}:${e.startLine}-${e.endLine}\` — ${e.note}`);
    }
    lines.push("", "**Reproduction:**", "", f.reproduction, "");
    lines.push("**Suggested fix:**", "", f.suggestedFix, "");
  }

  return lines.join("\n");
}
```

`packages/shared/src/index.ts`:
```ts
export * from "./endpoint.js";
export * from "./finding.js";
export * from "./sarif.js";
export * from "./report.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/test/report.test.ts`
Expected: PASS (4 tests, 1 snapshot written).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add markdown report renderer"
```

---

### Task 6: cli package — exit-code contract

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/exit-code.ts`
- Test: `packages/cli/test/exit-code.test.ts`

- [ ] **Step 1: Create package scaffold**

`packages/cli/package.json`:
```json
{
  "name": "@authzscan/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "authzscan": "./src/bin.ts" },
  "dependencies": {
    "@authzscan/shared": "workspace:*",
    "commander": "^14.0.0"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

Exit-code contract from spec: `0` clean / `1` confirmed findings / `2` error.

`packages/cli/test/exit-code.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { exitCodeForFindings, EXIT } from "../src/exit-code.js";
import type { TFinding } from "@authzscan/shared";

const base: TFinding = {
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

describe("exit codes", () => {
  it("exposes the contract constants", () => {
    expect(EXIT).toEqual({ CLEAN: 0, FINDINGS: 1, ERROR: 2 });
  });

  it("returns CLEAN for empty findings", () => {
    expect(exitCodeForFindings([])).toBe(EXIT.CLEAN);
  });

  it("returns CLEAN when all findings rejected", () => {
    expect(exitCodeForFindings([{ ...base, verdict: "rejected" }])).toBe(EXIT.CLEAN);
  });

  it("returns FINDINGS when any finding confirmed", () => {
    expect(exitCodeForFindings([{ ...base, verdict: "rejected" }, base])).toBe(EXIT.FINDINGS);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/test/exit-code.test.ts`
Expected: FAIL — cannot resolve `../src/exit-code.js`.

- [ ] **Step 4: Write minimal implementation**

`packages/cli/src/exit-code.ts`:
```ts
import type { TFinding } from "@authzscan/shared";

export const EXIT = { CLEAN: 0, FINDINGS: 1, ERROR: 2 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitCodeForFindings(findings: TFinding[]): ExitCode {
  return findings.some((f) => f.verdict === "confirmed") ? EXIT.FINDINGS : EXIT.CLEAN;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/test/exit-code.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli pnpm-lock.yaml
git commit -m "feat(cli): add exit-code contract (0 clean / 1 findings / 2 error)"
```

---

### Task 7: cli package — commander program with scan stub

**Files:**
- Create: `packages/cli/src/program.ts`
- Create: `packages/cli/src/bin.ts`
- Test: `packages/cli/test/program.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/cli/test/program.test.ts`:
```ts
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
      model: "claude-fable-5",
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/test/program.test.ts`
Expected: FAIL — cannot resolve `../src/program.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/cli/src/program.ts`:
```ts
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
```

`packages/cli/src/bin.ts`:
```ts
#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { EXIT } from "./exit-code.js";

const program = buildProgram(() => {
  // Engine lands in Plan 03; the CLI contract exists now so CI wiring can start early.
  console.error("authzscan: scan engine not implemented yet (Plan 03)");
  process.exit(EXIT.ERROR);
});

program.parse();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/test/program.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): add commander program with scan command stub"
```

---

### Task 8: Full-suite verification

**Files:** none new.

- [ ] **Step 1: Run complete test suite**

Run: `pnpm test`
Expected: PASS — all suites green (endpoint 7, finding 5, sarif 4, report 4, exit-code 4, program 4 = 28 tests).

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0, no errors.

- [ ] **Step 3: Smoke-test the binary**

Run: `pnpm --filter @authzscan/cli exec tsx src/bin.ts --help`
(If `tsx` is missing: `pnpm add -Dw tsx` first.)
Expected: usage text listing the `scan` command. Then:

Run: `pnpm --filter @authzscan/cli exec tsx src/bin.ts scan ./nowhere`
Expected: stderr "authzscan: scan engine not implemented yet (Plan 03)", exit code 2.

- [ ] **Step 4: Commit any stragglers**

```bash
git add -A
git commit -m "chore: foundation plan complete - shared + cli skeleton green"
```

---

## Spec coverage map (Plan 01 slice)

| Spec requirement | Task |
|---|---|
| pnpm monorepo layout | 1 |
| Finding/Endpoint zod schemas | 2, 3 |
| Confidence model | 3 |
| SARIF 2.1.0 serializer | 4 |
| MD report + explicit coverage statement ("degrade loudly") | 5 |
| Exit codes 0/1/2 | 6 |
| CLI flags (`--format`, `--max-endpoints`, `--budget`, `--resume`, `--model`) | 7 |

Deferred to later plans: inventory parser (Plan 02), Agent SDK engine + `.authzscan/` artifacts + retry/budget runtime behavior (Plan 03), benchmark + eval (Plan 04). `authzscan.config.ts` config-file support deferred to Plan 03 (it configures engine behavior; YAGNI until the engine exists).
