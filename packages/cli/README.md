# authzscan

Object-level authorization review for Next.js App Router repos, driven by Claude agents.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx authzscan scan ./my-next-app
```

Most access-control bugs aren't "no login." They're a logged-in user reaching *other people's* data: an endpoint fetches `orders/[id]` keyed only on the client-supplied `id`, with no `WHERE userId = session.user`. Pattern-matching SAST largely misses this class, because the broken query is a near-copy of the correct one and deciding *whose* row it returns means reasoning about the code rather than matching syntax against it.

Four passes. Only two of them ask a model anything:

1. **Inventory** walks the AST for every route handler and Server Action and detects the auth library. Deterministic, `ts-morph`.
2. **Trace** follows each client-controlled identifier to the database call it reaches.
3. **Verify** re-reads the cited code adversarially and throws the finding out unless a concrete "user A reaches user B's resource" path survives.
4. **Render** emits Markdown, SARIF 2.1.0, or JSON, plus an exit code: `0` nothing confirmed, `1` confirmed findings, `2` the scan itself broke.

Endpoints that can't be analyzed are reported as *not analyzed*, never as "clean."

## Measured

On a benchmark of 16 planted IDOR/BOLA bugs next to 6 hardened twins (near-identical endpoints that are correctly scoped, there to catch a tool that cries wolf), running `claude-sonnet-4-6`:

100% recall (16/16, easy 6/6, medium 6/6, hard 4/4) and 100% precision (17 confirmed, 0 false positives, 0 twins flagged), at $2.10 and about 19 minutes per scan.

That's one run, not a mean, so there's no error bar on it yet.

The benchmark is a 24-file app, and that number does not carry to a real codebase. A scan of [rallly](https://github.com/lukevella/rallly) produced 11 candidates, of which hand review kept one genuine finding and one harmless missing consistency check. Findings are leads for human review. Finding nothing is not the same as being safe.

## In CI

`--since` keeps a per-pull-request scan cheap; `--baseline` keeps already-triaged findings from holding the build red.

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }        # --since needs the base branch in the clone
- run: npx authzscan@latest scan . --since origin/${{ github.base_ref }} --baseline .authzscan-baseline.json --fail-on medium
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Adopting it on a repo that already has findings: run it once, review, then `--baseline .authzscan-baseline.json --update-baseline` to freeze what you are not fixing today. Entries key on the endpoint id, so they keep matching as the model's wording moves between runs.

Exit codes are the contract: `0` everything in scope analyzed and nothing confirmed at or above `--fail-on`, `1` confirmed findings, `2` the scan broke or left endpoints unanalyzed. Code `2` is deliberate, since a partial run has no opinion about the endpoints it never reached.

## Options

| Flag | Default | Description |
|---|---|---|
| `--format <md\|sarif\|json>` | `md` | Output format written to stdout. |
| `--since <ref>` | off | Only analyze endpoints in files that differ from this git ref. |
| `--baseline <file>` | none | Suppress findings on endpoints recorded in this file. |
| `--update-baseline` | off | Rewrite `--baseline` from this run's confirmed findings, then exit `0`. |
| `--fail-on <high\|medium\|low>` | `low` | Lowest confidence that exits `1`. |
| `--max-endpoints <n>` | all | Cap endpoints analyzed, for a cheap first pass. |
| `--budget <usd>` | none | Stop before the next endpoint group once estimated spend reaches this. Checked between groups, so it can overshoot by one group. |
| `--resume` | off | Resume from `.authzscan/` artifacts after an interrupted run. |
| `--model <id>` | `claude-sonnet-4-6` | Any adaptive-thinking Anthropic model. |

Requires Node 20 or newer and an `ANTHROPIC_API_KEY`. Add `.authzscan/` to your `.gitignore`; reports and resume artifacts are written there inside the scanned repo. A scan costs real API spend, and cost tracks endpoint groups multiplied by repository size rather than endpoint count. `--budget` stops the run between groups, so treat it as a stop signal rather than a hard ceiling: the measured overshoot on a 650-file repo was $0.81.

The trace and verify phases send source to the Anthropic API, restricted to `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.sql` and `.prisma` files inside the scanned directory. Nothing else leaves the machine, and there is no authzscan server or telemetry.

Full docs, the pipeline in detail, and the eval harness: https://github.com/davidldv/authzscan

MIT.
