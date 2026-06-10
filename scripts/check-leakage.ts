import { grepRepo } from "../packages/engine/src/index.js";

const hits = grepRepo("benchmark", "VULN|intentional|insecure|seeded|answer.key");
console.log("leak hits:", JSON.stringify(hits));
process.exit(hits.length === 0 ? 0 : 1);
