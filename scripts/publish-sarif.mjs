#!/usr/bin/env node
// Push a SARIF file to this repo's GitHub code scanning tab, so the README can
// show authzscan findings rendered as real alerts.
//
//   node scripts/publish-sarif.mjs benchmark/.authzscan/results.sarif benchmark
//
// Second argument is the path prefix the scan ran under. A scan of ./benchmark
// emits URIs relative to ./benchmark, and GitHub resolves them against the repo
// root, so without the prefix every alert points at a file that does not exist.
// Needs gh authenticated with code-scanning access. This publishes to a public
// repo; run it deliberately.
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const [file, prefix = ""] = process.argv.slice(2);
if (!file) throw new Error("usage: publish-sarif.mjs <results.sarif> [path-prefix]");

const sarif = JSON.parse(readFileSync(file, "utf8"));
if (prefix) {
  for (const run of sarif.runs ?? [])
    for (const r of run.results ?? [])
      for (const loc of r.locations ?? []) {
        const a = loc.physicalLocation?.artifactLocation;
        if (a?.uri) a.uri = `${prefix.replace(/\/+$/, "")}/${a.uri}`;
      }
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const commit = sh("git", ["rev-parse", "HEAD"]);
const ref = `refs/heads/${sh("git", ["rev-parse", "--abbrev-ref", "HEAD"])}`;
const payload = gzipSync(Buffer.from(JSON.stringify(sarif))).toString("base64");

console.log(sh("gh", [
  "api", "-X", "POST", "repos/davidldv/authzscan/code-scanning/sarifs",
  "-f", `commit_sha=${commit}`, "-f", `ref=${ref}`, "-f", `sarif=${payload}`,
  "-f", "tool_name=authzscan",
]));
console.log(`\nuploaded ${sarif.runs?.[0]?.results?.length ?? 0} result(s) for ${commit.slice(0, 7)} on ${ref}`);
console.log("alerts appear at https://github.com/davidldv/authzscan/security/code-scanning after processing");
