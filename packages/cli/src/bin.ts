#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { EXIT } from "./exit-code.js";

const program = buildProgram(() => {
  // Engine lands in Plan 03; the CLI contract exists now so CI wiring can start early.
  console.error("authzscan: scan engine not implemented yet (Plan 03)");
  process.exit(EXIT.ERROR);
});

program.parse();
