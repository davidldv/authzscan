#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { runScanCommand } from "./run-scan.js";

const program = buildProgram((repo, opts) => {
  void runScanCommand(repo, opts);
});

program.parse();
