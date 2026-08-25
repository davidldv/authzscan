# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase. The tool is a pnpm workspace monorepo (ESM TypeScript, `tsx`, no build step for the CLI). The landing page is `landing/index.html` — currently a single self-contained file with inline CSS/JS, deployed by drag-drop to Vercel or a `gh-pages` branch. The user granted free rein on that file's structure.

## Users

Two audiences read the same page, and the tie-break goes to the first:

1. **Hiring managers, AppSec engineers, and technical interviewers** evaluating David Londoño as a candidate pivoting from full-stack into application security. They are reading the page as a work sample. They want evidence he can define a problem, build a measuring instrument, and report the number honestly — including its limits.
2. **Next.js engineers** with an App Router codebase who might actually run a scan. They are skeptical of AI security tooling because they have been burned by false-positive floods.

Both arrive from a link (GitHub, portfolio, a message) rather than search. Both decide in seconds whether this is a toy.

## Product Purpose

authzscan finds object-level authorization bugs (IDOR / BOLA — OWASP A01, Broken Access Control) in Next.js App Router repos. Success is a maintainer running one scan and getting a short list of real "user A can reach user B's data" paths, with the file and line, and trusting the list enough to act on it.

## Positioning

The mechanism a neighboring tool cannot truthfully copy: deciding *whose* data a query returns is a reasoning problem, not a pattern-matching one. `orders/[id]` keyed on a client-supplied `id` with no `WHERE userId = session.user` is syntactically identical to the correctly-scoped version. Pattern-matching SAST (Semgrep, Snyk, Copilot) largely misses this class because there is no syntax to match on.

Second differentiator: **it is measured.** Most AI security tools ship claims. This one ships a benchmark, a harness sanity gate, and a number that could have come out badly.

Third: **it degrades loudly.** Endpoints that cannot be analyzed are reported as *not analyzed*, never as "clean." Unverifiable candidates surface as low-confidence `UNVERIFIED` rather than being dropped. Silence is never mistaken for safety.

## Operating Context

- Run from a terminal against a local repo: `npx authzscan scan ./my-app`.
- Requires an `ANTHROPIC_API_KEY`. A full scan of the 22-endpoint benchmark cost $2.10 and ~19 minutes.
- Outputs Markdown, SARIF 2.1.0 (uploadable to GitHub code scanning), or JSON, plus `.authzscan/report.md` and `.authzscan/results.sarif` in the scanned repo.
- Exit codes: `0` clean, `1` confirmed findings, `2` scan error — designed to wire into CI.
- The four-phase pipeline: **Inventory** (deterministic, `ts-morph` — enumerate route handlers and Server Actions, detect the auth library, extract the repo's own ownership idioms), **Trace** (Claude agent — follow each client-controlled identifier to the DB query it reaches), **Verify** (Claude agent, adversarial — re-read the cited code and kill false positives), **Render** (deterministic). Only phases 2 and 3 call the model.

## Capabilities and Constraints

- **In scope:** object-level authorization in Next.js App Router route handlers and Server Actions.
- **Out of scope by design:** XSS, SQLi, SSRF, authentication flaws, function-level authorization, the Pages Router.
- Not hardened for production security sign-off. Findings are leads for human review; absence of findings is not proof of safety. This hedge is a product commitment, not a disclaimer to be softened.
- Model-dependent: results are measured on `claude-sonnet-4-6`.

## Brand Commitments

- Name is lowercase: `authzscan`.
- Author: David Londoño (`davidldv`). Repo: `github.com/davidldv/authzscan`. MIT.
- Voice: plain, technical, unhyped. The product's whole argument is that it does not oversell, so the page may not oversell either.

## Evidence on Hand

Real, measured, and citable:

- **Eval, 2026-08-25, `claude-sonnet-4-6`, single run:** 100% recall (16/16 seeded vulns — easy 6/6, medium 6/6, hard 4/4) and 100% precision (17 confirmed findings, 0 false positives, 0 unknowns). Cost $2.10, duration ~19 min. Both gates (≥80% recall, ≥70% precision) passed. Report: `eval-reports/2026-08-25T03-25-50-383Z.md`.
- Two of the 17 findings point at the same seeded vuln (a route handler and its Server Action share a file), so the run confirmed 16 distinct bugs, not 17. This nuance must be stated, not buried.
- **Benchmark:** a Next.js app with 16 seeded IDOR/BOLA vulns plus **6 hardened twins** — structurally near-identical but correctly scoped — acting as false-positive tripwires. Zero label leakage: no `// VULN` markers to grep. The live eval scans a temp copy with `vulns.json` removed.
- **Harness sanity gate:** a `PerfectRunner` oracle answers from the manifest and must score 1.0/1.0, proving the harness is correct independently of model quality.
- Real finding ids from the run, usable as page content: `idor-orders-get-by-id-no-ownership-filter`, `idor-transfer-order-no-ownership-check`, `idor-search-unscoped-accountid`, `idor-teams-members-get-missing-user-scope`, `idor-sharedocument-no-caller-ownership-check`, `idor-exportreport-no-ownership-check`, and others in the eval log.

Absent — must never be fabricated: no users, no customers, no testimonials, no downloads or stars count, no real-world CVE or third-party repo finding (not yet run), no multi-run mean ± stddev (n=1), no pricing, no company.

## Product Principles

1. **Measured, not claimed.** Every number on any surface traces to a committed eval report. A guarded page (`landing/verify.mjs`) bans placeholder and mockup numbers from shipping.
2. **Degrade loudly.** Never let unanalyzed read as clean, in the tool or in the copy.
3. **One bug class, done properly.** Narrow scope is the credibility, not a limitation to apologize for.
4. **State the limits in the same breath as the result.** n=1, model-dependent, leads-not-proof. The honesty is the product's differentiator against AI-security hype.
5. **Determinism where determinism is possible.** The model is called only where reasoning is genuinely required.

## Accessibility & Inclusion

No product-specific requirement was established beyond standard practice: the page must keep semantic landmarks and headings (a prior task added them deliberately), visible focus states, and readable contrast.
