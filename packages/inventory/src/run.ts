import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Project } from "ts-morph";
import { InventoryResult, type TEndpoint, type TInventoryResult } from "@authzscan/shared";
import { endpointId } from "./id.js";
import { routePathFromFile } from "./route-path.js";
import { extractRouteHandlers } from "./route-handlers.js";
import { extractServerActions } from "./server-actions.js";
import { usesDb, findAuthIndicators } from "./indicators.js";
import { detectAuthLibrary, findOwnershipIdioms, buildAuthProfile, type PackageJsonDeps } from "./auth-profile.js";

function readPackageJson(repoPath: string): PackageJsonDeps {
  const pkgPath = path.join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJsonDeps;
  } catch {
    return {};
  }
}

export function runInventory(repoPath: string): TInventoryResult {
  const appDir = path.join(repoPath, "app");
  if (!existsSync(appDir)) {
    throw new Error(`no app/ directory found in ${repoPath} — is this a Next.js App Router repo?`);
  }

  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });
  const glob = `${appDir.replace(/\\/g, "/")}/**/*.{ts,tsx,js,jsx}`;
  project.addSourceFilesAtPaths(glob);

  const endpoints: TEndpoint[] = [];
  const skippedFiles: Array<{ file: string; reason: string }> = [];
  const sessionPatterns = new Set<string>();
  const ownershipIdioms = new Set<string>();

  for (const sf of project.getSourceFiles()) {
    const relFile = path.relative(repoPath, sf.getFilePath()).replace(/\\/g, "/");
    try {
      for (const p of findAuthIndicators(sf)) sessionPatterns.add(p);
      for (const idiom of findOwnershipIdioms(sf)) ownershipIdioms.add(idiom);

      const fileUsesDb = usesDb(sf);
      const fileAuth = findAuthIndicators(sf);

      const routeInfo = routePathFromFile(relFile);
      if (routeInfo) {
        for (const handler of extractRouteHandlers(sf)) {
          endpoints.push({
            id: endpointId(relFile, handler.exportName),
            kind: "route-handler",
            file: relFile,
            method: handler.method,
            routePath: routeInfo.routePath,
            params: routeInfo.params,
            usesDb: fileUsesDb,
            authIndicators: fileAuth,
          });
        }
        continue;
      }

      for (const actionName of extractServerActions(sf)) {
        endpoints.push({
          id: endpointId(relFile, actionName),
          kind: "server-action",
          file: relFile,
          method: null,
          routePath: null,
          params: [],
          usesDb: fileUsesDb,
          authIndicators: fileAuth,
        });
      }
    } catch (err) {
      skippedFiles.push({ file: relFile, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const authProfile = buildAuthProfile({
    library: detectAuthLibrary(readPackageJson(repoPath)),
    sessionAccessPatterns: [...sessionPatterns].sort(),
    ownershipIdioms: [...ownershipIdioms].sort(),
  });

  return InventoryResult.parse({ endpoints, authProfile, skippedFiles });
}
