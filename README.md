# authzscan

Finds the IDOR and BOLA bugs in a Next.js App Router codebase, for the engineer who has to sign off on authorization before a release.

Most access-control bugs aren't "no login." They're a logged-in user reaching *other people's* data. An endpoint fetches `orders/[id]` keyed only on the client-supplied `id`, with no `WHERE userId = session.user`, and user A reads user B's order. That's [OWASP A01: Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/), the top web risk, and pattern-matching SAST tools (Semgrep, Snyk, Copilot) largely miss it. Deciding *whose* data a query returns means reasoning about the code, not matching syntax against it.

authzscan does that reasoning. It reads like a pentest of your authorization logic rather than a linter with an LLM bolted on.

> **Fit for:** an advisory authorization review in CI or before a release, on top of the SAST you already run. Its output is leads worth a reviewer's time, and a confirmed finding is a strong one. It is not a compliance artifact and not a substitute for a pentest, because finding nothing is not the same as being safe. Every number here comes from a real run; see [Does it actually find bugs](#does-it-actually-find-bugs).

---

## Does it actually find bugs

The benchmark is a Next.js app carrying 16 planted IDOR/BOLA bugs next to 6 hardened twins: near-identical endpoints that are correctly scoped, sitting there to catch a tool that cries wolf. There is no label leakage. Nothing in the source says `// VULN` for the agent to grep.

Measured on `claude-sonnet-4-6`, single run, 2026-08-25:

| | |
|---|---|
| Planted bugs found | 16 of 16, a **100% detection rate** |
| Missed | 0 |
| False positives | 0, out of 17 confirmed findings |
| Hardened twins wrongly flagged | 0 of 6 |
| By difficulty | easy 6/6, medium 6/6, hard 4/4 |
| Cost | $2.10 per scan |
| Wall clock | about 19 minutes |
| Gates (80% recall, 70% precision) | both pass |

Every planted bug, and what kind of bug it is:

| ID | Bug class | Difficulty | Found |
|---|---|---|---|
| V1 | direct fetch by client id, session checked but query unscoped | easy | yes |
| V2 | direct fetch by client id, no auth at all | easy | yes |
| V3 | delete by client id, no ownership check | easy | yes |
| V4 | update by client id, no ownership check | easy | yes |
| V5 | Server Action deletes by client id, no ownership check | easy | yes |
| V6 | direct fetch by client id, no auth at all | easy | yes |
| V7 | GET scoped to the user, DELETE in the same file is not | medium | yes |
| V8 | mutates the userId the client sent, not the session's | medium | yes |
| V9 | list filtered by the client's tenant id, no membership check | medium | yes |
| V10 | ownership transfer that never checks the caller owns it | medium | yes |
| V11 | Server Action checks the session exists, never ownership | medium | yes |
| V12 | ownership compared after the write already landed | medium | yes |
| V13 | reached through a relation, the parent is never checked | hard | yes |
| V14 | raw SQL scoped by a client-supplied account id | hard | yes |
| V15 | ownership checked against the recipient, not the caller | hard | yes |
| V16 | membership lookup omits the caller, so any row passes | hard | yes |

Now the parts that number does not cover, because publishing a benchmark result without its caveats is worth about as much as not publishing one.

It is a single run, not a mean across many, so there is no error bar on it. It would move on another model. Two of the 17 confirmed findings landed on the same planted bug, since a route handler and its Server Action share one file, so the run confirmed 16 distinct bugs rather than 17. And a benchmark somebody wrote on purpose is easier than a codebase that grew by accident. For what a real repository looks like, see [Scope and limits](#scope-and-limits).

The harness gets checked separately from the model. A `PerfectRunner` oracle answers straight out of the manifest and has to score 1.0 / 1.0, which proves the scoring is right no matter how the model performs. The live eval scans a temp copy of the benchmark with `vulns.json` removed, so the agent under test can never reach the answer key.

```bash
pnpm eval:fake          # zero-cost harness sanity check (PerfectRunner oracle)
pnpm eval --runs 3      # live eval on Sonnet 4.6, costs real API spend
```

Reports land in `eval-reports/`.

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

### Why phase 1 has no model in it

Enumerating route handlers is a parsing problem, and parsing problems have right answers. `ts-morph` walks the AST and returns the same endpoint list every time, in about a second, for nothing. An agent asked to do that same job would cost money, take minutes, and occasionally miss a file. There is no upside.

Deciding whether `prisma.order.findUnique({ where: { id } })` lets user A read user B's order is a different kind of question. The answer depends on what middleware did three files away, on whether `id` got rewritten between the route and the query, and on the ownership idiom this particular codebase happens to use, which might be `WHERE userId`, or a `withOwner()` helper, or a Prisma extension nobody documented. Grep cannot decide that, and neither can a rule written by someone who has never seen the repo.

So the rule the pipeline follows is: deterministic wherever the question has a right answer, a model only where judgment is actually required, then a second model pass whose only job is to argue with the first. Trace is rewarded for suspicion, verify for skepticism. Collapse them into one pass and you get a wall of maybes, which is how most LLM security tools end up unused.

---

## Install

Requires Node 20 or newer and an Anthropic API key.

```bash
npx authzscan@latest scan ./my-next-app
```

Or pin it as a dev dependency so every developer and every CI run uses the same version:

```bash
npm install --save-dev authzscan
# or
pnpm add -D authzscan
```

Set the key:

```bash
# bash
export ANTHROPIC_API_KEY=sk-ant-...
# PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

Add `.authzscan/` to your `.gitignore`. The scan writes its artifacts and reports there, inside the repo being scanned.

To work on authzscan itself rather than run it, clone the repo and see [Repository layout](#repository-layout).

---

## Usage

```bash
authzscan scan <path-to-nextjs-repo>
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--format <md\|sarif\|json>` | `md` | Output format written to stdout. |
| `--since <ref>` | off | Only analyze endpoints in files that differ from this git ref. The way to run it on a pull request without paying for the whole repo. |
| `--baseline <file>` | none | Suppress findings on endpoints recorded in this file, so accepted risk does not keep the build red. |
| `--update-baseline` | off | Rewrite `--baseline` from this run's confirmed findings, then exit `0`. |
| `--fail-on <high\|medium\|low>` | `low` | Lowest confidence that exits `1`. Findings below it are still reported. |
| `--max-endpoints <n>` | all | Cap endpoints analyzed (useful for a cheap first pass). |
| `--budget <usd>` | none | Stop before the next endpoint group once estimated spend reaches this. Checked between groups, not inside one, so it can overshoot by a single group's cost. Measured overshoot on a 650-file repo: $0.81. |
| `--resume` | off | Resume from `.authzscan/` artifacts after an interrupted run. |
| `--model <id>` | `claude-sonnet-4-6` | Anthropic model id. Any adaptive-thinking model works (Sonnet 4.6, Opus 4.x). |

### Output

The report goes to stdout in whichever `--format` you asked for, and `.authzscan/report.md` plus `.authzscan/results.sarif` are always written into the scanned repo.

The exit code is the CI contract:

| Code | Meaning |
|------|---------|
| `0` | Every endpoint in scope was analyzed and nothing at or above `--fail-on` was confirmed. |
| `1` | At least one confirmed finding at or above `--fail-on`. |
| `2` | The scan itself broke, ran out of budget, or left endpoints unanalyzed. |

Code `2` is deliberate. A run that only got through half the endpoints has no opinion about the other half, and a scanner that turns "I ran out of budget" into a green check is worse than no scanner.

---

## Use it in CI

Two things make a scanner survive contact with a real team: it has to be cheap enough to run per pull request, and it must not sit red forever on findings that have already been triaged. `--since` handles the first, `--baseline` the second.

Scan only what the pull request touched:

```yaml
name: authzscan
on: pull_request

permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload below

jobs:
  authz:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # --since needs the base branch in the clone
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx authzscan@latest scan . --since origin/${{ github.base_ref }} --baseline .authzscan-baseline.json --fail-on medium
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: .authzscan/results.sarif
```

A pull request that touches no route handler or Server Action analyzes nothing and costs nothing. When `--since` is on, the summary says so out loud, because endpoints outside the diff were not reviewed and the exit code should not be read as if they were.

### Adopting it on a repo that already has findings

Run it once across the whole repo, review what it found, fix what you're going to fix, then freeze the rest:

```bash
authzscan scan . --baseline .authzscan-baseline.json --update-baseline
```

That writes one entry per endpoint that currently has a confirmed finding, with the title and an empty `reason` field for you to fill in during review. Commit it. From then on those endpoints stop failing the build while anything new still does. Entries are keyed on the endpoint id, which is derived from the file path and export name, so a baseline keeps matching across runs even though the model's wording and line numbers move. Move or rename the file and the entry stops matching, which is the right behavior: the code changed, so look again.

### Pinning the version

Scan results depend on the model, and the model is not deterministic. Pin both if you want run-to-run stability worth comparing: `authzscan` as a dev dependency rather than `@latest`, and an explicit `--model`. Expect some drift regardless. Treat a single run as evidence, not as a measurement.

### What leaves your machine

The trace and verify phases send source code to the Anthropic API. The agent can list, grep and read files under the scanned directory, restricted to `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.sql` and `.prisma`, and skipping `node_modules`, `.git`, `.next`, `dist` and `.authzscan`. Paths outside the scanned directory are refused, and so is any other file type, so a `.env` or a key file cannot be pulled into a prompt. In practice it reads the endpoints under review and the files they reach, but treat that whole matching source tree as in scope.

Inventory and render run locally and send nothing. There is no authzscan server, no telemetry, and no network destination other than the Anthropic API. It is your key, your account, and your organization's data retention terms. If your source cannot go to a third-party API, this tool is not for you.

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

In scope: object-level authorization (IDOR/BOLA) in Next.js App Router route handlers and Server Actions, in both the `app/` and `src/app/` layouts. Deliberately out of scope: XSS, SQLi, SSRF, authentication flaws, function-level authorization, the Pages Router. One class of bug done properly beats ten done badly.

The benchmark number above is measured on a 24-file app. On a real repository the picture is different: a scan of [rallly](https://github.com/lukevella/rallly) produced 11 candidates, of which one was a genuine finding and one a harmless missing consistency check. Cost tracks endpoint groups multiplied by repository size, not endpoint count, so price a scan with `pnpm exec tsx scripts/size.ts <repo>` before running one.

Findings are leads for human review. A confirmed finding is a strong signal. Finding nothing is not the same as being safe.

---

## License

MIT
