# authzscan MVP — Design

**Date:** 2026-06-09
**Status:** Approved by David Londoño
**Working name:** `authzscan` (sibling of `jwt-scan`)

## Purpose

CLI tool that performs autonomous, agentic detection of IDOR/BOLA (broken object-level authorization) vulnerabilities in Next.js App Router codebases, powered by Claude Fable 5 via the Claude Agent SDK.

**Primary goal: portfolio-first.** Success in the next 2–3 months means a polished open-core CLI plus a credible technical writeup with measured detection numbers. Revenue is optional and deferred. The project doubles as the strongest possible AppSec-pivot portfolio piece.

**Positioning:** not "AI SAST" (a lane occupied by Semgrep, Snyk, and GitHub Copilot Autofix). This is an autonomous pentest-style review of authorization logic — the flaw class rule-based SAST cannot pattern-match because it requires reasoning about application semantics. The verify phase and coverage guarantees are what separate this from a naive "Fable wrapper."

## Scope

### In scope (v1)

- **Flaw class:** IDOR/BOLA only. Object-level authorization: routes or actions that fetch/mutate a resource by identifier without verifying the requesting user's ownership or tenancy.
- **Target framework:** Next.js App Router only. Route handlers (`app/**/route.ts|js`) and Server Actions (`'use server'`, both file-level and inline).
- **Data layer:** Prisma-query awareness first-class; raw SQL handled best-effort in v1 (trace agent may follow it, but inventory does not specifically model it).
- **Output:** Markdown report + SARIF 2.1.0 + CI exit codes.
- **Engine:** Claude Agent SDK (TypeScript). Fable 5 default model, `--model` flag fallback.
- **Validation:** seeded vulnerable benchmark app + real-repo passes (labodega, paircode, securepay).

### Out of scope (v1)

- Other authz flaws (role escalation, missing route-level auth, multi-tenancy beyond object ownership) — v2 candidates.
- Cheap-model triage routing (Haiku pre-filter) — v2 cost optimization.
- Pages Router, other frameworks, hosted/SaaS tier, GitHub App, billing.

## Architecture

Chosen approach: **structured pipeline — inventory → trace → verify** (over single-pass agent and triage-routed variants). Rationale: measurable coverage ("47/47 routes analyzed"), per-phase tunability, bounded cost, and an adversarial verify phase for false-positive control.

### Repository layout

pnpm workspace monorepo at `Dev\authzscan` (pnpm chosen deliberately: strict lockfile, no phantom dependencies — package manager posture matches the tool's security posture):

```
authzscan/
├── packages/
│   ├── cli/          # npm-published CLI — entry, config, report rendering
│   ├── inventory/    # static parser: route/action enumeration (no LLM)
│   ├── engine/       # Agent SDK orchestration: trace + verify phases
│   └── shared/       # finding types, SARIF serializer, confidence model
├── benchmark/        # deliberately-vulnerable Next.js app, ~15–20 seeded IDORs
└── docs/
```

### Flow

```
npx authzscan ./repo
  → inventory: Endpoint[] + AuthProfile          (deterministic JSON, seconds, free)
  → engine/trace: CandidateFinding[]             (Fable agent per endpoint group)
  → engine/verify: Finding[]                     (confirmed/rejected + confidence)
  → shared/render: report.md + results.sarif + stdout summary
  → exit code: 0 clean / 1 findings / 2 error    (jwt-scan convention)
```

Every phase writes its artifact to a `.authzscan/` workdir (`inventory.json`, `candidates.json`, `findings.json`). Phases are resumable via `--resume`: agent runs cost money; a crash mid-scan must not restart from zero.

## Components

### `packages/inventory` — deterministic attack-surface parser

No LLM involvement. Input: repo path. Output: `Endpoint[]` JSON.

- Detects: HTTP method exports in `app/**/route.ts|js`, Server Action functions (file-level and inline `'use server'`), dynamic segments (`[id]`, `[...slug]`).
- Per endpoint extracts: method, path params, body usage, imports touching the database (Prisma client references), auth-wrapper presence (middleware matchers, known helpers such as `auth()`, `getServerSession`).
- Emits an **auth-context profile**: detected auth library (NextAuth / Clerk / Lucia / custom), session-access patterns, and ownership-check idioms found in the repo. This profile feeds trace prompts so the agent knows what "protected" looks like *in this specific repo*.
- Implementation: `ts-morph` AST analysis. No regex parsing.

### `packages/engine` — Agent SDK orchestration

**Trace phase.** Endpoints grouped by resource (e.g., all `/api/orders/*` share ownership semantics). One agent session per group; tools are read/grep scoped to the target repo; the task: trace request parameter → database query, flag any fetch/mutate-by-id lacking an ownership or tenancy check. Emits `CandidateFinding` with a code-path evidence chain (file:line sequence).

**Verify phase.** Fresh agent per candidate with an adversarial prompt: "prove this is exploitable — construct a concrete attack (user A's session, user B's resource id) or reject the finding." No shared state with the trace agent, ensuring independent judgment. Output: confidence (`high` / `medium` / `low`), reproduction narrative, suggested fix.

### `packages/shared`

`Finding` schema (zod), SARIF 2.1.0 serializer, Markdown report templater, confidence model.

### `packages/cli`

Argument parsing, config file (`authzscan.config.ts`), progress UI, exit codes, `--format md|sarif|json`, `--max-endpoints`, `--budget`, `--resume`, `--model`.

### `benchmark/`

Deliberately vulnerable Next.js + Prisma + SQLite app. 15–20 seeded IDOR variants tagged in a manifest (`vulns.json`: id, file, type, difficulty). Variants include: direct fetch-by-id, missing tenancy filter, ownership check on GET but not DELETE, check in UI but not in the Server Action, indirect reference leak. Several routes have **hardened twins** that act as false-positive tripwires.

## Cost control (v1)

- Prompt caching: repo context cached across endpoint groups (90% input discount).
- Endpoint batching by resource group.
- `--max-endpoints` and `--budget` flags; engine tracks usage per phase and halts cleanly at the cap with partial results preserved.
- No triage model in v1 — portfolio-first means detection rate outranks cost. Triage routing is the natural v2.

## Error handling

Hard rule: **degrade loudly, never silently.** A false "clean" report is worse than a crash — this is a security tool.

- **Inventory parse failure** (unusual TS config, unparseable file): file-level warning, continue; the report lists "files skipped" — the attack surface is never silently shrunk. Repo-level failure (no `app/` directory) → exit 2 with a clear message.
- **Agent failures** (API error, rate limit, refusal): retry twice with exponential backoff. Persistent failure → endpoint group marked `unscanned` in the report; the scan continues. Report header states coverage explicitly: "44/47 endpoints analyzed, 3 failed."
- **Cybersecurity classifier reroute** (Fable may route some security prompts to Opus 4.8): prompts are framed as defensive code review to stay in the Fable lane; if output quality suggests a degraded model, log it. Non-fatal.
- **Malformed agent output:** zod-validate every agent response; on failure, one re-prompt including the schema error, then mark the endpoint `unscanned`.

## Testing & validation

### Unit tests (vitest, TDD)

- `inventory`: fixture mini-repos → assert exact `Endpoint[]` output. Cases: route handlers, inline/file Server Actions, dynamic segments, middleware matchers, each supported auth library. Pure functions, fast, no LLM.
- `shared`: SARIF output validated against the 2.1.0 schema; Markdown templater snapshot tests; zod schemas round-trip.
- `cli`: argument/config parsing, exit-code mapping.

### Engine tests (no live LLM in CI)

- Agent SDK calls mocked; orchestration logic under test: grouping, retry, resume, budget halt, malformed-output handling.
- Prompt templates snapshot-tested so prompt drift is visible in diffs.

### Benchmark evaluation (live Fable, run locally — the headline numbers)

- `pnpm eval` runs a full scan against `benchmark/` and diffs findings against the `vulns.json` manifest.
- Metrics: **recall** (seeded vulns caught), **precision** (hardened twins catch false positives), per-difficulty breakdown, cost per scan, wall time.
- Each eval report is committed, making tuning history visible in git.
- **Quality gates for calling v1 done: ≥80% recall, ≥70% precision.**
- Non-determinism: eval runs 3×; report mean and variance.

### Real-world pass

Scan `labodega`, `paircode`, `securepay`. Findings manually triaged. Any confirmed real finding → fix it and produce an anonymized case study for the writeup.

## Deliverables

1. `authzscan` CLI, pnpm monorepo, open-source.
2. Benchmark app with seeded-vulnerability manifest.
3. Eval harness with committed tuning history.
4. Technical writeup: architecture, detection numbers (recall/precision/variance/cost), real-world case studies.
