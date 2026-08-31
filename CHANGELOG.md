# Changelog

## 0.2.0

Everything a team needs to run this on a real repository on every pull request:
scope the scan to the diff, park findings that have already been triaged, and
choose which confidence level breaks the build.

### Added

- `--since <ref>` analyzes only endpoints in files that differ from a git ref.
  A pull request that touches no route handler or Server Action now costs
  nothing. The summary states the scope out loud, because endpoints outside the
  diff were not reviewed and the exit code must not be read as if they were. An
  unresolvable ref fails the run rather than silently narrowing the scan to
  nothing, which is the shape a shallow CI clone takes.
- `--baseline <file>` suppresses findings on endpoints recorded in it, and
  `--update-baseline` writes that file from the current run. Entries key on the
  endpoint id, derived from file path and export name, so a baseline keeps
  matching across runs even though the model's wording and line numbers move.
  Renaming the file drops the entry, which is correct: the code changed.
- `--fail-on <high|medium|low>` sets the lowest confidence that exits `1`.
  Findings below it are still reported. Model output varies between runs, so a
  team can hold the build to high-confidence findings without losing the rest.
- A GitHub Actions workflow for this repository: typecheck, tests, a CLI build,
  and the landing-page claim check on every pull request.

### Fixed

- The agent's `read_file` tool accepted any path inside the scanned repository,
  including files the `list_files` allowlist never advertised. A prompt bound for
  a third-party API could therefore have carried a `.env` or a key file. Reads
  are now restricted to the same source extensions `list_files` returns.

### Changed

- The README leads with `npx authzscan` rather than a source checkout, documents
  the exit-code contract as a table, and states what source code leaves the
  machine and where it goes.
- `packageManager` is pinned so CI and local installs resolve the same pnpm.

## 0.1.1

First release after running the scanner against real open-source repositories
rather than only its own benchmark. Every entry below is a bug that a 24-file
benchmark could not surface.

### Fixed

- Repositories using Next's `src/app/` layout were rejected as "not a Next.js App
  Router repo". Both layouts are now resolved, and route paths under `src/app/`
  map correctly instead of falling through to the Server Action branch.
- A scan that analyzed nothing exited `0`. The exit code now accounts for
  coverage: confirmed findings exit `1` even on a partial scan, an empty result
  exits `0` only when every endpoint was reached, and `2` otherwise.
- The trace phase retried every endpoint group after a systematic failure such as
  unresolvable credentials. It now stops after three consecutive group failures
  and reports the remaining groups as not analyzed.
- Ownership idioms were extracted only from files under the app directory. A
  repository keeping its authorization helpers in `features/` or `lib/` was
  reported as having no ownership conventions, and the trace agent then judged
  every query against nothing. Idiom extraction now covers the whole source root
  while endpoints still come only from the app directory.
- `list_files` returned every source path with no cap, roughly 17k tokens on a
  1500-file repository, re-sent on every turn of each group's conversation. Past
  300 files it now returns directories with file counts and points at grep.
- `--resume` adopted the output of a phase that had given up, so a verify pass
  starved by the budget was cached as finished and never re-run. Artifacts now
  record whether the phase completed. An incomplete trace resumes on the
  endpoints it never reached rather than re-paying for the whole phase.

### Changed

- `--budget` documents that it is checked between endpoint groups, so it can
  overshoot by one group's cost.
- The CLI version and the SARIF `toolVersion` come from one constant, guarded by
  a test against `package.json`.

### Added

- `scripts/size.ts` prices a scan before it runs, using the deterministic first
  phase only.
