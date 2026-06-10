import { runInventory } from "../packages/inventory/src/index.js";

const r = runInventory("benchmark");
console.log(`${r.endpoints.length} endpoints, ${r.skippedFiles.length} skipped`);
if (r.skippedFiles.length > 0) {
  console.error(r.skippedFiles);
  process.exit(1);
}
