import { execFileSync } from "node:child_process";

/**
 * Repo-relative paths (forward slashes) that differ from `ref`, per git.
 *
 * `--relative` makes git report paths against `repoPath` rather than the git
 * root, so the result lines up with `endpoint.file` even when the scanned app
 * is a subdirectory of the repository.
 *
 * Throws rather than returning an empty set: a ref that git cannot resolve
 * (shallow clone, unfetched base branch) would otherwise silently narrow the
 * scan to nothing and hand CI a green check.
 */
export function changedFiles(repoPath: string, ref: string): Set<string> {
  let out: string;
  try {
    out = execFileSync("git", ["diff", "--name-only", "--relative", ref], {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(
      `--since ${ref}: git could not diff against that ref in ${repoPath} (${detail}). ` +
        `In CI this usually means a shallow clone — use actions/checkout with fetch-depth: 0.`,
    );
  }
  return new Set(
    out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
}
