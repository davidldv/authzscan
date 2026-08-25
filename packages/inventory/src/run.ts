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
  // Next.js allows both layouts; a repo using src/app is not a different kind of repo.
  const appDir = [path.join(repoPath, "app"), path.join(repoPath, "src", "app")].find(existsSync);
  if (appDir === undefined) {
    throw new Error(`no app/ or src/app/ directory found in ${repoPath} — is this a Next.js App Router repo?`);
  }

  // Endpoints only ever live under the app dir, but a repo's ownership idioms
  // usually do not: features/, lib/ and server/ are where the authorization
  // helpers live. Scanning only app/ reports "no ownership idioms" for a repo
  // that has a strict convention, and the trace agent then judges every query
  // against nothing.
  const srcRoot = path.dirname(appDir);
  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths([
    `${srcRoot.replace(/\\/g, "/")}/**/*.{ts,tsx,js,jsx}`,
    "!**/node_modules/**",
    "!**/.next/**",
    "!**/dist/**",
    "!**/build/**",
    "!**/*.d.ts",
  ]);

  const appPrefix = `${path.relative(repoPath, appDir).replace(/\\/g, "/")}/`;

  const endpoints: TEndpoint[] = [];
  const skippedFiles: Array<{ file: string; reason: string }> = [];
  const sessionPatterns = new Set<string>();
  const ownershipIdioms = new Set<string>();

  for (const sf of project.getSourceFiles()) {
    const relFile = path.relative(repoPath, sf.getFilePath()).replace(/\\/g, "/");
    try {
      for (const p of findAuthIndicators(sf)) sessionPatterns.add(p);
      for (const idiom of findOwnershipIdioms(sf)) ownershipIdioms.add(idiom);

      if (!relFile.startsWith(appPrefix)) continue;

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
