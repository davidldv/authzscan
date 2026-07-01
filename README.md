# authzscan

**Autonomous IDOR/BOLA review for Next.js App Router repos, driven by Claude agents.**

Most access-control bugs aren't "no login." They're authenticated users reaching *other people's* data: an endpoint fetches `orders/[id]` keyed only on the client-supplied `id`, with no `WHERE userId = session.user`. User A reads User B's order. This is [OWASP A01: Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) — the #1 web risk — and pattern-matching SAST tools (Semgrep, Snyk, Copilot) largely miss it, because deciding *whose* data a query returns requires reasoning about the code, not matching syntax.

authzscan does that reasoning. It's an **autonomous pentest of your authorization logic**, not an AI linter.

> ⚠️ **Status: portfolio / research tool.** Validated against a seeded benchmark (see [Eval](#eval)). Not yet hardened for production security sign-off. Treat findings as leads for human review, not a clean bill of health.

---

## How it works

A four-phase pipeline. Only phases 2 and 3 call the model; phase 1 is fully deterministic.

| Phase | What it does | Engine |
|-------|--------------|--------|
| **1. Inventory** | Enumerate every route handler and Server Action, detect the auth library (next-auth, Clerk, Lucia, custom), and extract the repo's own ownership idioms. | Deterministic — `ts-morph`, no LLM |
| **2. Trace** | Per endpoint group: follow each client-controlled identifier (route param, body field, query) to the DB query it reaches, and flag queries with no ownership/tenancy scope. | Claude agent |
| **3. Verify** | Adversarial second pass: re-read the cited code, kill false positives, and confirm only when a concrete "user A reaches user B's resource" scenario holds. | Claude agent |
| **4. Render** | Emit a Markdown report, [SARIF 2.1.0](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning) (GitHub code scanning), or JSON, plus a CI exit code. | Deterministic |

**Degrade loudly, never silently:** endpoints that can't be analyzed are reported as *not analyzed* (never as "clean"), and candidates that can't be verified are surfaced as low-confidence `UNVERIFIED` rather than dropped.

---

## Install

Requires Node ≥ 20 and [pnpm](https://pnpm.io). (Built on pnpm deliberately — strict-by-default dependency resolution.)

```bash
git clone https://github.com/davidldv/authzscan.git
cd authzscan
pnpm install
```

Set your Anthropic key for live scans:

```bash
# PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
# bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Usage

The CLI runs through `tsx` (source TypeScript, no build step):

```bash
pnpm exec tsx packages/cli/src/bin.ts scan <path-to-nextjs-repo>
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--format <md\|sarif\|json>` | `md` | Output format written to stdout. |
| `--max-endpoints <n>` | all | Cap endpoints analyzed (useful for a cheap first pass). |
| `--budget <usd>` | none | Halt the scan once estimated spend reaches this ceiling. |
| `--resume` | off | Resume from `.authzscan/` artifacts after an interrupted run. |
| `--model <id>` | `claude-sonnet-4-6` | Anthropic model id — any adaptive-thinking model (Sonnet 4.6, Opus 4.x). |

### Output

- **stdout** — the report in the chosen `--format`.
- **`.authzscan/report.md`** and **`.authzscan/results.sarif`** — always written in the scanned repo.
- **Exit code** — `0` clean · `1` confirmed findings · `2` scan error. Wire it straight into CI.

```bash
pnpm exec tsx packages/cli/src/bin.ts scan ./my-app --format sarif > results.sarif
# upload results.sarif to GitHub code scanning
```

---

## Eval

Credibility comes from a measured benchmark, not vibes.

- **Benchmark:** a Next.js app with **16 seeded IDOR/BOLA vulnerabilities** (6 easy / 6 medium / 4 hard) plus **6 hardened twins** that act as false-positive tripwires. Zero label leakage — there are no `// VULN` markers the agent could grep for.
- **Metrics:** recall (vulns found / 16) and precision (true positives / all confirmed), averaged across runs with mean ± stddev.
- **Gates:** ≥ 80% recall, ≥ 70% precision.
- **Sanity gate:** a `PerfectRunner` oracle answers from the manifest and must score 1.0 / 1.0 — this proves the *harness* is correct independent of model quality. The live eval scans a temp copy of the benchmark with `vulns.json` removed, so the agent under test can never read the answer key.

```bash
pnpm eval:fake          # zero-cost harness sanity check (PerfectRunner oracle)
pnpm eval --runs 3      # live eval on Sonnet 4.6 — costs real API spend
```

Reports land in `eval-reports/`.

---

## Repository layout

A pnpm workspace monorepo (ESM TypeScript):

```
packages/
  shared/      zod schemas, SARIF + Markdown rendering, finding sort
  inventory/   deterministic ts-morph endpoint enumeration + auth detection
  engine/      pipeline (trace, verify, scan), Anthropic tool runner, budget guard
  cli/         the `authzscan scan` command + exit codes
  eval/        benchmark manifest, classifier, metrics, multi-run report, eval CLI
benchmark/     seeded-vulnerability Next.js app + vulns.json manifest
```

```bash
pnpm test        # full vitest suite
pnpm typecheck   # tsc --noEmit across all packages
```

---

## Scope and limits

- **In scope:** object-level authorization (IDOR/BOLA) in Next.js App Router route handlers and Server Actions.
- **Out of scope (by design):** XSS, SQLi, SSRF, authn flaws, function-level authz, the Pages Router. Doing one class of bug well beats doing ten poorly.
- Findings are **leads for human review.** A confirmed finding is a strong signal; absence of findings is not proof of safety.

---

## License

MIT
