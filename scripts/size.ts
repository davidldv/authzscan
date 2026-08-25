// Free pre-flight: phase 1 is deterministic, so we can price a scan before spending anything.
import { runInventory } from "../packages/inventory/src/run.js";
import { groupEndpoints } from "../packages/engine/src/group.js";

for (const repo of process.argv.slice(2)) {
  try {
    const inv = runInventory(repo);
    const groups = groupEndpoints(inv.endpoints);
    console.log(
      `${repo}\n  endpoints ${inv.endpoints.length} (route-handler ${inv.endpoints.filter((e) => e.kind === "route-handler").length}, server-action ${inv.endpoints.filter((e) => e.kind === "server-action").length})` +
        `\n  relevant(db|params) ${groups.reduce((n, g) => n + g.endpoints.length, 0)} in ${groups.length} trace group(s)` +
        `\n  auth ${inv.authProfile.library}  idioms ${inv.authProfile.ownershipIdioms.length}  skipped ${inv.skippedFiles.length}`,
    );
  } catch (e) {
    console.log(`${repo}\n  FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}
