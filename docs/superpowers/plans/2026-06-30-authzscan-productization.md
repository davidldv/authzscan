# authzscan Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish authzscan as a one-command `npx authzscan ./my-app` npm package and ship a single static landing page marketing it with a real, measured eval number.

**Architecture:** Repurpose `packages/cli` into a single public `authzscan` npm package; `tsup` bundles the four internal `@authzscan/*` packages into one `dist/bin.js`, with third-party deps installed on demand. The landing page is one self-contained `landing/index.html` (inline CSS/JS, no build). The eval number and the npm publish are David's manual triggers; all code work here is Claude's.

**Tech Stack:** TypeScript (ESM), pnpm workspace, tsup (esbuild), commander, @anthropic-ai/sdk, vitest. Static HTML/CSS/JS for the landing page.

## Global Constraints

- **Node ≥ 20** (`engines.node >= 20`), ESM (`"type": "module"`) throughout.
- **One bundled package only.** Publish `authzscan`; the `@authzscan/{engine,inventory,shared}` packages stay `private` and unpublished — they are bundled in, never dependencies of the published package.
- **No fabricated facts.** The recall/precision metric on the landing page comes only from a real eval run; the `npx authzscan` line only ships because the package is really published. The mockup numbers `82%`/`91%` must never appear anywhere.
- **Model must be adaptive-thinking.** The runner hardcodes `output_config.effort: "high"`; `--model` default stays `claude-sonnet-4-6` (Sonnet 4.6 / Opus 4.x only).
- **Commits** end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Work on branch `feat/productization`.
- **Do not run the live eval or `npm publish` — those are David's triggers.**

## Manual prerequisites (David, not code tasks)

- **Phase 1 — the number:** `pnpm eval -- --runs 3 --model claude-sonnet-4-6` (~$2–6), paste the report. Feeds Task 4.
- **Publish:** `npm publish` from `packages/cli` (needs npm login + 2FA). Gates the page going public.
- **Deploy:** drop `landing/` on Vercel or a `gh-pages` branch.

---

### Task 0: Secure `.env` and land the pending model-default changes

The working tree already holds the committed-elsewhere model-default edits (README, `program.ts`, `program.test.ts`, two snapshots, `eval/bin.ts`) and an untracked `.env` that is **not** gitignored — a leak risk. Clean the tree before packaging.

**Files:**
- Modify: `.gitignore`
- Commit (already-modified): `README.md`, `packages/cli/src/program.ts`, `packages/cli/test/program.test.ts`, `packages/engine/test/__snapshots__/prompts.test.ts.snap`, `packages/eval/src/bin.ts`, `packages/eval/test/__snapshots__/report.test.ts.snap`

- [ ] **Step 1: Ignore `.env`**

Append to `.gitignore`:

```
.env
.env.*
```

- [ ] **Step 2: Confirm `.env` is now ignored**

Run: `git check-ignore .env`
Expected: prints `.env` (exit 0).

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: all tests pass (129–133 across the 29 files).

- [ ] **Step 4: Commit the model-default work + gitignore**

```bash
git add .gitignore README.md packages/cli/src/program.ts packages/cli/test/program.test.ts packages/engine/test/__snapshots__/prompts.test.ts.snap packages/eval/src/bin.ts packages/eval/test/__snapshots__/report.test.ts.snap
git commit -m "chore: default to Sonnet 4.6, gitignore .env

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Verify `.env` is NOT staged: `git status --short` shows `.env` still untracked (`??`), never in the commit.

---

### Task 1: Bundle the CLI with tsup

Produce a single self-contained `dist/bin.js` that inlines the workspace packages.

**Files:**
- Create: `packages/cli/tsup.config.ts`
- Modify: `packages/cli/package.json` (add tsup, build script, move workspace deps to devDeps)

**Interfaces:**
- Produces: `packages/cli/dist/bin.js` — an ESM executable with a `#!/usr/bin/env node` shebang, runnable via `node dist/bin.js` and later as the `authzscan` bin.

- [ ] **Step 1: Add tsup config**

Create `packages/cli/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  // Inline the internal workspace packages; leave third-party deps external
  // so npm installs them from the published `dependencies`.
  noExternal: [/^@authzscan\//],
});
```

- [ ] **Step 2: Wire up package.json build**

In `packages/cli/package.json`: add `tsup` to `devDependencies`, move the `@authzscan/*` deps from `dependencies` to `devDependencies` (build-time only — they get bundled), keep `commander` in `dependencies`, and add a `build` script. After this step `dependencies` holds only third-party runtime deps; the file will be completed in Task 2. Interim shape:

```jsonc
{
  "scripts": { "build": "tsup" },
  "dependencies": { "commander": "^14.0.0" },
  "devDependencies": {
    "@authzscan/engine": "workspace:*",
    "@authzscan/shared": "workspace:*",
    "tsup": "^8.0.0"
  }
}
```

- [ ] **Step 3: Install and build**

Run: `pnpm install && pnpm --filter authzscan build`
(`--filter authzscan` won't match until Task 2 renames; until then use `pnpm --filter @authzscan/cli build`.)
Expected: tsup writes `packages/cli/dist/bin.js`, no unresolved-import errors.

- [ ] **Step 4: Verify the bundle is a runnable, shebang-topped executable**

Run: `head -1 packages/cli/dist/bin.js && node packages/cli/dist/bin.js --help`
Expected: first line is `#!/usr/bin/env node`; help output includes the `scan` command and `--model` option.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/tsup.config.ts packages/cli/package.json pnpm-lock.yaml
git commit -m "build: bundle authzscan CLI with tsup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Make the package publishable

Rename to `authzscan`, add publish metadata, LICENSE, package README, and prove the tarball runs.

**Files:**
- Modify: `packages/cli/package.json`
- Create: `LICENSE`, `packages/cli/LICENSE`, `packages/cli/README.md`

**Interfaces:**
- Consumes: `dist/bin.js` from Task 1.
- Produces: an installable tarball whose `bin` `authzscan` resolves and runs.

- [ ] **Step 1: Rewrite `packages/cli/package.json` for publish**

```json
{
  "name": "authzscan",
  "version": "0.1.0",
  "description": "Autonomous IDOR/BOLA (broken access control) review for Next.js App Router repos, driven by Claude agents.",
  "keywords": ["idor", "bola", "broken-access-control", "authorization", "nextjs", "security", "owasp", "sast", "appsec"],
  "homepage": "https://github.com/davidldv/authzscan#readme",
  "repository": { "type": "git", "url": "https://github.com/davidldv/authzscan.git", "directory": "packages/cli" },
  "author": "David Londoño <dlondon.dev@gmail.com>",
  "license": "MIT",
  "type": "module",
  "bin": { "authzscan": "dist/bin.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public" },
  "scripts": { "build": "tsup", "prepack": "pnpm build" },
  "dependencies": { "commander": "^14.0.0" },
  "devDependencies": {
    "@authzscan/engine": "workspace:*",
    "@authzscan/shared": "workspace:*",
    "tsup": "^8.0.0"
  }
}
```

Note: `private: true` is gone. `prepack` rebuilds `dist` before every `npm pack`/`npm publish`.

- [ ] **Step 2: Add the MIT LICENSE (root + package)**

Create `LICENSE` (repo root) with the standard MIT text, `Copyright (c) 2026 David Londoño`:

```
MIT License

Copyright (c) 2026 David Londoño

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Then copy it so npm ships it with the package: `cp LICENSE packages/cli/LICENSE`.

- [ ] **Step 3: Add a package README**

Create `packages/cli/README.md` (the npm page). A trimmed pointer is fine:

```markdown
# authzscan

**Autonomous IDOR/BOLA review for Next.js App Router repos, driven by Claude agents.**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx authzscan scan ./my-next-app
```

Finds authenticated users reaching *other people's* data (OWASP A01 broken access
control) — the class pattern-matching SAST misses. Emits Markdown / SARIF / JSON plus a
CI exit code (`0` clean · `1` findings · `2` error).

Full docs, the four-phase pipeline, and the benchmark eval:
https://github.com/davidldv/authzscan
```

- [ ] **Step 4: Inspect the tarball contents**

Run: `cd packages/cli && npm pack --dry-run`
Expected: the file list is exactly `dist/**`, `README.md`, `LICENSE`, `package.json` — no `src/`, no tests.

- [ ] **Step 5: Smoke-test the real tarball end to end**

```bash
cd packages/cli && npm pack                       # -> authzscan-0.1.0.tgz
mkdir -p "$TMPDIR/azs-smoke" && cd "$TMPDIR/azs-smoke"
npm init -y >/dev/null && npm i "$OLDPWD/authzscan-0.1.0.tgz"
npx authzscan scan ../../Dev/authzscan/benchmark --max-endpoints 1
```

Expected: the run reaches the model/auth stage — it errors on a **missing `ANTHROPIC_API_KEY`** or attempts the API call. It must **not** fail with `Cannot find module '@authzscan/...'` — that would mean the bundle didn't inline the workspace packages. (`npx authzscan --help` printing usage is the free structural warm-up.)

- [ ] **Step 6: Commit**

```bash
git add packages/cli/package.json packages/cli/README.md packages/cli/LICENSE LICENSE
git commit -m "feat: publishable authzscan npm package (npx-able)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **David's trigger (not a code step):** `cd packages/cli && npm publish`. Effectively permanent (72h unpublish window). After it lands, `npx authzscan ./my-app` is true and the landing hero is unblocked.

---

### Task 3: Build the landing page

One self-contained static page; a guard script enforces the no-fabricated-facts rule.

**Files:**
- Create: `landing/index.html`, `landing/verify.mjs`

**Interfaces:**
- Consumes: the real `npx authzscan` command (true after publish) and the eval metric (filled in Task 4).
- Produces: a deployable static page.

- [ ] **Step 1: Write `landing/index.html`**

Single file, inline CSS, one copy-button script. Metric renders as a `data-metric` slot showing `pending eval` until Task 4. Complete content:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>authzscan — autonomous IDOR/BOLA review for Next.js</title>
<meta name="description" content="Finds the broken-access-control bug your SAST misses. Autonomous authz review for Next.js App Router, driven by Claude agents.">
<style>
  :root { --bg:#0b0e14; --fg:#e6e6e6; --muted:#8b949e; --accent:#6ee7b7; --card:#141922; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.6 system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  .wrap { max-width:860px; margin:0 auto; padding:0 20px; }
  section { padding:64px 0; border-bottom:1px solid #1e2530; }
  h1 { font-size:2.6rem; margin:0 0 .3em; line-height:1.15; }
  h2 { font-size:1.6rem; margin-top:0; }
  .tag { color:var(--accent); font-weight:600; letter-spacing:.5px; text-transform:uppercase; font-size:.8rem; }
  .muted { color:var(--muted); }
  code, pre { font-family:ui-monospace,monospace; }
  .cmd { display:flex; align-items:center; gap:12px; background:var(--card); border:1px solid #263041; border-radius:10px; padding:14px 18px; margin:24px 0; }
  .cmd code { color:var(--accent); font-size:1.05rem; }
  .cmd button { margin-left:auto; background:#1f2733; color:var(--fg); border:1px solid #364155; border-radius:6px; padding:6px 12px; cursor:pointer; }
  .cta { display:inline-block; background:var(--accent); color:#08130d; font-weight:700; text-decoration:none; padding:12px 22px; border-radius:8px; margin-right:12px; }
  .cta.ghost { background:transparent; color:var(--fg); border:1px solid #364155; }
  .badge { display:inline-block; background:var(--card); border:1px solid #263041; border-radius:8px; padding:10px 16px; margin-top:24px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid #263041; border-radius:10px; padding:18px; }
  .card b { color:var(--accent); }
  pre.block { background:var(--card); border:1px solid #263041; border-radius:10px; padding:16px; overflow:auto; }
  a { color:var(--accent); }
  footer { padding:40px 0; color:var(--muted); font-size:.9rem; }
</style>
</head>
<body>
<section class="wrap">
  <div class="tag">OWASP A01 · broken access control</div>
  <h1>Finds the IDOR your SAST misses. Autonomously.</h1>
  <p class="muted">authzscan is an autonomous pentest of your authorization logic for Next.js App Router repos — not an AI linter. It reasons about <em>whose</em> data a query returns, the thing pattern-matching tools can't.</p>
  <div class="cmd">
    <code id="install">npx authzscan scan ./my-app</code>
    <button onclick="navigator.clipboard.writeText(document.getElementById('install').textContent)">copy</button>
  </div>
  <a class="cta" href="https://github.com/davidldv/authzscan">★ Star on GitHub</a>
  <a class="cta ghost" href="#proof">See the eval</a>
  <div class="badge" data-metric>Benchmark result: <b>pending eval</b> — 16 seeded IDOR/BOLA + 6 hardened twins</div>
</section>

<section class="wrap">
  <div class="tag">The problem</div>
  <h2>Authenticated ≠ authorized.</h2>
  <p>Most access-control bugs aren't "no login." They're a logged-in user reaching <em>other people's</em> data — an endpoint fetches <code>orders/[id]</code> keyed only on the client-supplied <code>id</code>, with no <code>WHERE userId = session.user</code>. User A reads User B's order.</p>
  <p class="muted">Deciding whose data a query returns needs reasoning about the code, not matching syntax — which is why Semgrep, Snyk, and Copilot largely miss this class.</p>
</section>

<section class="wrap">
  <div class="tag">How it works</div>
  <h2>A four-phase pipeline. Only two phases call the model.</h2>
  <div class="cards">
    <div class="card"><b>1 · Inventory</b><br>Enumerate every route handler & Server Action, detect the auth library, extract the repo's ownership idioms. <span class="muted">Deterministic — ts-morph.</span></div>
    <div class="card"><b>2 · Trace</b><br>Follow each client-controlled id to the DB query it reaches; flag queries with no ownership scope. <span class="muted">Claude agent.</span></div>
    <div class="card"><b>3 · Verify</b><br>Adversarial second pass — re-read the code, kill false positives, confirm only real "A reaches B" paths. <span class="muted">Claude agent.</span></div>
    <div class="card"><b>4 · Render</b><br>Markdown, SARIF 2.1.0, or JSON, plus a CI exit code. <span class="muted">Deterministic.</span></div>
  </div>
</section>

<section class="wrap" id="proof">
  <div class="tag">The proof</div>
  <h2>Measured against a benchmark, not vibes.</h2>
  <p>A Next.js app with <b>16 seeded IDOR/BOLA vulnerabilities</b> (6 easy / 6 medium / 4 hard) plus <b>6 hardened twins</b> that act as false-positive tripwires. Zero label leakage — no <code>// VULN</code> markers to grep.</p>
  <ul>
    <li><b data-metric>Result: pending eval</b> — recall (found / 16) and precision (true positives / all confirmed), mean ± stddev across runs.</li>
    <li>Gates: ≥ 80% recall, ≥ 70% precision.</li>
    <li>A <code>PerfectRunner</code> oracle must score 1.0 / 1.0 — proving the <em>harness</em> is correct independent of model quality. The live eval scans a copy with the answer key removed.</li>
  </ul>
</section>

<section class="wrap">
  <div class="tag">Install</div>
  <pre class="block">export ANTHROPIC_API_KEY=sk-ant-...
npx authzscan scan ./my-next-app --format sarif &gt; results.sarif</pre>
  <p class="muted">Exit code <code>0</code> clean · <code>1</code> findings · <code>2</code> error — wire it straight into CI.</p>
  <footer>
    <a href="https://github.com/davidldv/authzscan">GitHub</a> · MIT · built by <a href="https://github.com/davidldv">David Londoño</a>
    <br><span class="muted">Portfolio / research tool. Findings are leads for human review, not a clean bill of health.</span>
  </footer>
</section>
</body>
</html>
```

- [ ] **Step 2: Write the guard script**

Create `landing/verify.mjs`:

```js
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const required = ["npx authzscan", "github.com/davidldv/authzscan"];
const banned = ["82%", "91%"]; // invented mockup numbers must never ship
for (const s of required) if (!html.includes(s)) throw new Error(`missing required string: ${s}`);
for (const s of banned) if (html.includes(s)) throw new Error(`fabricated mockup number present: ${s}`);
console.log("landing check ok");
```

- [ ] **Step 3: Run the guard**

Run: `node landing/verify.mjs`
Expected: prints `landing check ok`.

- [ ] **Step 4: Eyeball it**

Open `landing/index.html` in a browser; confirm all five sections render, the copy button copies the install command, and the metric shows `pending eval` (not a number).

- [ ] **Step 5: Commit**

```bash
git add landing/index.html landing/verify.mjs
git commit -m "feat: authzscan landing page (metric pending eval)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Fill the real metric (gated on David's eval run)

> **PREREQUISITE:** David has run Phase 1 (`pnpm eval -- --runs 3 --model claude-sonnet-4-6`) and pasted the report. Do not invent numbers.

**Files:**
- Modify: `landing/index.html` (both `data-metric` slots), `landing/verify.mjs`

- [ ] **Step 1: Read the real numbers from the pasted eval report**

Extract mean recall and precision (e.g. `recall 0.83 ± 0.04`, `precision 0.90 ± 0.02`) and whether both gates passed.

- [ ] **Step 2: Replace both `pending eval` slots with the real figures**

In the hero badge and the proof `<li>`, swap `pending eval` for the measured values, e.g. `83% recall · 90% precision (mean of 3 runs)`. Use only the pasted numbers.

- [ ] **Step 3: Tighten the guard so a placeholder can never ship again**

In `landing/verify.mjs`, add `"pending eval"` to the `banned` array. Keep `"82%"`/`"91%"` banned only if they don't collide with a real result; if a genuine measured value is 82%/91%, drop that entry from `banned` (the number is now true).

- [ ] **Step 4: Run the guard**

Run: `node landing/verify.mjs`
Expected: `landing check ok`.

- [ ] **Step 5: Commit**

```bash
git add landing/index.html landing/verify.mjs
git commit -m "feat: real eval metric on landing page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **David's trigger (not a code step):** deploy `landing/` to Vercel (drag-drop) or a `gh-pages` branch. The page is now public with a true install line and a true number.

---

## Self-review

- **Spec coverage:** Phase 1 → manual prerequisite + Task 4 gate. Phase 2 packaging → Tasks 1–2 (tsup bundle, publishable metadata, LICENSE, README, pack smoke test) + David's publish trigger. Phase 3 landing page → Task 3 (all five sections, no fabricated facts) + David's deploy trigger. The `.env` leak and pending model-default changes → Task 0. All spec sections map to a task.
- **No fabricated facts:** enforced twice — `pending eval` slot in Task 3, guard script bans the mockup numbers, Task 4 bans the placeholder after the real number lands.
- **Type/name consistency:** package renamed `@authzscan/cli` → `authzscan` once (Task 2); `--filter` name caveat noted in Task 1 Step 3; `dist/bin.js` referenced consistently across Tasks 1–2; `data-metric` slots consistent across Task 3 and Task 4.
