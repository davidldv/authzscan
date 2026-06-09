import { Node, type SourceFile } from "ts-morph";
import { AuthProfile, type TAuthProfile } from "@authzscan/shared";

export interface PackageJsonDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const OWNERSHIP_KEYS = /\b(userId|ownerId|tenantId|organizationId|accountId)\b/;

export function detectAuthLibrary(pkg: PackageJsonDeps): TAuthProfile["library"] {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps["next-auth"] || deps["@auth/core"]) return "next-auth";
  if (deps["@clerk/nextjs"]) return "clerk";
  if (deps["lucia"]) return "lucia";
  return "unknown";
}

export function findOwnershipIdioms(sf: SourceFile): string[] {
  const idioms = new Set<string>();
  sf.forEachDescendant((node) => {
    if (!Node.isPropertyAssignment(node) || node.getName() !== "where") return;
    const init = node.getInitializer();
    if (init && OWNERSHIP_KEYS.test(init.getText())) {
      idioms.add(init.getText().replace(/\s+/g, " "));
    }
  });
  return [...idioms].sort();
}

export function buildAuthProfile(input: TAuthProfile): TAuthProfile {
  const library =
    input.library === "unknown" && input.sessionAccessPatterns.length > 0 ? "custom" : input.library;
  return AuthProfile.parse({ ...input, library });
}
