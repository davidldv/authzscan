# Changelog

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
