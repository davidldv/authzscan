# authzscan

Object-level authorization review for Next.js App Router repos, driven by Claude agents.

Most access-control bugs aren't "no login." They're a logged-in user reaching *other people's* data. An endpoint fetches `orders/[id]` keyed only on the client-supplied `id`, with no `WHERE userId = session.user`, and user A reads user B's order. That's [OWASP A01: Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/), the top web risk, and pattern-matching SAST tools (Semgrep, Snyk, Copilot) largely miss it. Deciding *whose* data a query returns means reasoning about the code, not matching syntax against it.

authzscan does that reasoning. It reads like a pentest of your authorization logic rather than a linter with an LLM bolted on.

> **Status: portfolio and research tool.** Measured against a seeded benchmark (see [Eval](#eval)). Not hardened for a production security sign-off. Treat what it finds as leads worth a human's time, not a clean bill of health.

---

## How it works

A four-phase pipeline. Only phases 2 and 3 call the model; phase 1 is fully deterministic.

| Phase | What it does | Engine |
|-------|--------------|--------|
| **1. Inventory** | Enumerate every route handler and Server Action, detect the auth library (next-auth, Clerk, Lucia, custom), and extract the repo's own ownership idioms. | Deterministic: `ts-morph`, no LLM |
| **2. Trace** | Per endpoint group: follow each client-controlled identifier (route param, body field, query) to the DB query it reaches, and flag queries with no ownership/tenancy scope. | Claude agent |
| **3. Verify** | Adversarial second pass: re-read the cited code, kill false positives, and confirm only when a concrete "user A reaches user B's resource" scenario holds. | Claude agent |
| **4. Render** | Emit a Markdown report, [SARIF 2.1.0](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning) (GitHub code scanning), or JSON, plus a CI exit code. | Deterministic |

Degrade loudly, never silently. Endpoints that can't be analyzed are reported as *not analyzed*, never as "clean," and candidates the verify pass can't confirm surface as low-confidence `UNVERIFIED` instead of being dropped. A scanner that turns "I ran out of budget" into a green check is worse than no scanner, because someone will believe it.

---

## Install

Requires Node 20 or newer and [pnpm](https://pnpm.io), which is deliberate: its dependency resolution is strict by default.

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
| `--model <id>` | `claude-sonnet-4-6` | Anthropic model id. Any adaptive-thinking model works (Sonnet 4.6, Opus 4.x). |

### Output

The report goes to stdout in whichever `--format` you asked for, and `.authzscan/report.md` plus `.authzscan/results.sarif` are always written into the scanned repo. The exit code is `0` for nothing confirmed, `1` for confirmed findings, and `2` if the scan itself broke, so you can gate a build on it directly.

```bash
pnpm exec tsx packages/cli/src/bin.ts scan ./my-app --format sarif > results.sarif
# upload results.sarif to GitHub code scanning
```

---

## Eval

The benchmark is a Next.js app carrying 16 planted IDOR/BOLA bugs (6 easy, 6 medium, 4 hard) next to 6 hardened twins: near-identical endpoints that are correctly scoped, sitting there to catch a tool that cries wolf. There's no label leakage, since nothing in the source says `// VULN` for the agent to grep. Recall is bugs found over 16, precision is true positives over everything confirmed, and the gates are 80% recall and 70% precision.

Measured on `claude-sonnet-4-6`, single run, 2026-08-25:

| | |
|---|---|
| Recall | 100.0% (16/16) |
| Precision | 100.0% (17 confirmed, 0 false positives, 0 unknowns) |
| By difficulty | easy 6/6, medium 6/6, hard 4/4 |
| Hardened twins flagged | 0 of 6 |
| Cost | $2.10 per scan |
| Wall clock | about 19 minutes |
| Gates | both pass |

What that number doesn't cover: it's one run, not a mean across many, so there's no error bar on it yet. It would move on another model. Two of the 17 confirmed findings landed on the same planted bug, because a route handler and its Server Action live in one file, so the run confirmed 16 distinct bugs rather than 17. And a benchmark somebody wrote on purpose is easier than a codebase that grew by accident.

The harness gets checked separately. A `PerfectRunner` oracle answers straight out of the manifest and has to score 1.0 / 1.0, which proves the scoring is right no matter how the model performs. The live eval scans a temp copy of the benchmark with `vulns.json` removed, so the agent under test can never reach the answer key.

```bash
pnpm eval:fake          # zero-cost harness sanity check (PerfectRunner oracle)
pnpm eval --runs 3      # live eval on Sonnet 4.6, costs real API spend
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

In scope: object-level authorization (IDOR/BOLA) in Next.js App Router route handlers and Server Actions. Deliberately out of scope: XSS, SQLi, SSRF, authentication flaws, function-level authorization, the Pages Router. One class of bug done properly beats ten done badly.

Findings are leads for human review. A confirmed finding is a strong signal. Finding nothing is not the same as being safe.

---

## License

MIT
