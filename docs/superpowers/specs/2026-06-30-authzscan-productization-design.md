# authzscan Productization — npm CLI + landing page

**Date:** 2026-06-30
**Status:** approved, pre-implementation
**Depends on:** the MVP (Plans 01–04, all merged). Model default already moved to `claude-sonnet-4-6`.

## Goal

Turn authzscan from a clone-and-`tsx` research repo into a thing a stranger can run
in one command (`npx authzscan ./my-app`), backed by a **real** measured eval number,
and market it with a single-page OSS dev-tool landing page. Primary audience:
developers who'd scan their own repo, and the recruiters reviewing David for AppSec/SWE
roles. "Customers" = free users of an open-source tool, not paying SaaS tenants.

## The one hard rule

A security tool's landing page cannot state a number or a command that isn't true.
Two facts are load-bearing and **must be real before the page is public**:

1. The recall/precision metric — comes from an actual eval run, never a mockup figure.
2. The `npx authzscan` install line — only true after the package is published.

The page may be *built* ahead of both, but it does not go public until both land.

## Non-goals (YAGNI)

- Hosted SaaS, accounts, billing, a sandbox to run customer code. Out of scope by design.
- Publishing the four internal `@authzscan/*` packages. They are internal decomposition;
  they get bundled, not published.
- A GitHub Action wrapper. Reasonable follow-up, not this pass.
- Any framework/build tooling for the landing page. It is one static HTML file.

## Phase 1 — the number (David's trigger)

The only eval ever run is the `PerfectRunner` oracle (proves the harness, not the tool).
Get the real figure:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
pnpm eval -- --runs 1 --budget 2                    # smoke, ~$2
pnpm eval -- --runs 3 --model claude-sonnet-4-6     # full, the headline number
```

David runs it (spends his API budget), pastes the report; Claude reads the gates
(≥80% recall, ≥70% precision) and extracts the mean ± stddev for the page.
**Blocks:** the metric badge in the landing hero + proof section.

## Phase 2 — `npx`-able package (Claude builds; David publishes)

### Approach: one bundled package, not five

The four `@authzscan/*` packages are internal structure. Publish **one** public package
named `authzscan` (repurpose `packages/cli`); `tsup` bundles `cli → engine → inventory →
shared` source into a single `dist/bin.js`. Workspace imports get inlined; the real
third-party deps stay as `dependencies` npm installs on demand. `authzscan` is free on npm
(verified 404).

### Changes to `packages/cli/package.json`

- `name`: `@authzscan/cli` → `authzscan`
- Remove `private: true`; add `publishConfig: { access: "public" }`, `engines.node >= 20`.
- `bin`: `{ "authzscan": "dist/bin.js" }` (was `./src/bin.ts`).
- `files`: `["dist", "README.md", "LICENSE"]`.
- `dependencies`: promote the third-party deps the bundle needs at runtime —
  `commander`, `@anthropic-ai/sdk`, `zod`, `ts-morph`.
- Move the `@authzscan/*` `workspace:*` entries to `devDependencies` (not runtime deps):
  tsup needs them resolvable at build time to inline them, but they must **not** be
  published `dependencies` — `workspace:*` can't resolve from the npm registry and would
  break `npm install authzscan` for end users.
- Add `description`, `keywords` (idor, bola, broken-access-control, authorization,
  nextjs, security, owasp, sast), `repository`, `homepage`, `license: "MIT"`, `author`.
- `scripts`: `build: "tsup"`, `prepack: "pnpm build"` (npm builds before packing/publishing).

### `packages/cli/tsup.config.ts`

- `entry: ["src/bin.ts"]`, `format: ["esm"]`, `target: "node20"`, `clean: true`.
- `noExternal: [/^@authzscan\//]` — force the workspace packages into the bundle.
  Everything else stays external (tsup's default) and resolves from `dependencies`.
- Shebang (`#!/usr/bin/env node`) is preserved by tsup for the bin entry; npm marks
  `dist/bin.js` executable on install.

### Supporting files

- `LICENSE` (MIT) at repo root if missing — npm expects it.
- A package-local `README.md` for the `authzscan` package (copy the root README, or a
  trimmed version). `files` ships it as the npm page.

### Verification gate (the smoke test)

```bash
pnpm --filter authzscan build           # produces dist/bin.js
cd packages/cli && pnpm pack            # authzscan-0.1.0.tgz
# in a temp dir:
npm i ./authzscan-0.1.0.tgz
npx authzscan scan <path-to-benchmark> --max-endpoints 1
```

The point is to prove the bundle resolves every inlined workspace import at runtime.
Success criterion: the run reaches the model/auth stage (e.g. fails on a missing API key
or makes the call) rather than dying with a module-resolution error. A module-not-found
means the bundle is wrong. `authzscan --help` is the free structural warm-up.

### Publish (David's trigger)

`pnpm publish` (or `pnpm --filter authzscan publish`) from `packages/cli` — needs David's npm login + 2FA, and is effectively
permanent (npm's unpublish window is 72h). Claude does not push to David's account.

## Phase 3 — landing page (Claude builds; David deploys)

Single self-contained `landing/index.html`: inline CSS, minimal JS (one copy-to-clipboard
button on the install command; nothing else). No build, no deps — same pattern as the
existing `career-roadmap-2026Q3.html`. Deploy via Vercel drag-drop or a `gh-pages` branch.

Sections, top to bottom:

1. **Hero** — one-line what-it-is, the `npx authzscan ./my-app` command (copy button),
   primary CTA `★ Star on GitHub`, and the metric badge (real figure from Phase 1).
2. **The problem** — the `orders/[id]` IDOR example and why Semgrep/Snyk/Copilot miss it.
   Lifted from the README.
3. **How it works** — the four-phase pipeline as four cards (inventory → trace → verify →
   render), noting only phases 2–3 call the model.
4. **The proof** — the eval methodology: 16 seeded + 6 hardened tripwire twins, zero label
   leakage, the `PerfectRunner` sanity gate, and the real measured numbers. This is the
   differentiator — it says "I measure my own tool."
5. **Install / footer** — GitHub link, the working install, MIT license.

No fabricated metrics anywhere. Until Phase 1 lands, the metric renders as an obvious
`[pending eval]` placeholder that must not ship public.

## Sequencing & triggers

| # | Phase | Who | Gates |
|---|-------|-----|-------|
| 1 | Run the eval | **David** (API $) | the metric badge |
| 2 | Package + tsup + smoke test | Claude | — |
| 2b | `pnpm publish` | **David** (npm 2FA) | the `npx` hero line |
| 3 | Build landing page | Claude | — |
| 3b | Deploy page | **David** | — |

Claude can complete Phase 2 code and the Phase 3 page immediately, with the metric and
hero as slots. The page goes public once 1 + 2b land.

## Risks

- **Fabricated-fact risk** — the metric and install line must be real before publishing.
  Enforced by rendering an obvious placeholder, not a guessed number.
- **Publish permanence** — 72h unpublish window; ties to David's npm account. His trigger.
- **`ts-morph` install weight** — heavy dep, acceptable for a dev tool; noted, not fixed.
- **Model compatibility** — the runner hardcodes `output_config.effort: "high"`, which 400s
  on Haiku 4.5 / Sonnet 4.5. `--model` must be an adaptive-thinking model (Sonnet 4.6,
  Opus 4.x). Already documented in the README.
