# authzscan Plan 02: Inventory Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@authzscan/inventory` — deterministic, LLM-free attack-surface parser that turns a Next.js App Router repo into a validated `InventoryResult` (endpoints + auth profile + skipped files).

**Architecture:** ts-morph AST analysis, no regex parsing of code (regexes only on file *paths*). Small pure modules: path→route mapping, route-handler extraction, Server Action extraction, DB/auth indicator detection, auth-profile builder, and a `runInventory` orchestrator that walks the real filesystem, never silently shrinks the attack surface (per-file try/catch → `skippedFiles`), and zod-validates its own output against `@authzscan/shared`.

**Tech Stack:** ts-morph, zod (via `@authzscan/shared`), vitest. Unit tests use ts-morph in-memory file system; integration test uses a committed fixture repo.

**Plan series:** 01 foundation (done) → **02 inventory (this)** → 03 engine + CLI integration → 04 benchmark + eval.

**Spec:** `docs/superpowers/specs/2026-06-09-authzscan-mvp-design.md`

---

### Task 1: Package scaffold + endpoint id slug

**Files:**
- Create: `packages/inventory/package.json`
- Create: `packages/inventory/tsconfig.json`
- Create: `packages/inventory/src/id.ts`
- Create: `packages/inventory/src/index.ts`
- Test: `packages/inventory/test/id.test.ts`

- [ ] **Step 1: Create package scaffold**

`packages/inventory/package.json`:
```json
{
  "name": "@authzscan/inventory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@authzscan/shared": "workspace:*",
    "ts-morph": "^26.0.0"
  }
}
```

`packages/inventory/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/inventory/test/id.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { endpointId } from "../src/index.js";

describe("endpointId", () => {
  it("builds a stable slug from file and export name", () => {
    expect(endpointId("app/api/orders/[id]/route.ts", "GET")).toBe(
      "ep_app_api_orders_id_route_ts_get",
    );
  });

  it("is deterministic", () => {
    expect(endpointId("app/orders/actions.ts", "deleteOrder")).toBe(
      endpointId("app/orders/actions.ts", "deleteOrder"),
    );
  });

  it("distinguishes different exports in the same file", () => {
    expect(endpointId("app/api/x/route.ts", "GET")).not.toBe(endpointId("app/api/x/route.ts", "POST"));
  });

  it("normalizes Windows backslashes", () => {
    expect(endpointId("app\\api\\x\\route.ts", "GET")).toBe(endpointId("app/api/x/route.ts", "GET"));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/inventory/test/id.test.ts`
Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 4: Write minimal implementation**

`packages/inventory/src/id.ts`:
```ts
export function endpointId(file: string, exportName: string): string {
  const cleaned = `${file.replace(/\\/g, "/")}#${exportName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `ep_${cleaned}`;
}
```

`packages/inventory/src/index.ts`:
```ts
export * from "./id.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/inventory/test/id.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/inventory pnpm-lock.yaml
git commit -m "feat(inventory): scaffold package with endpoint id slug"
```

---

### Task 2: Route path mapping (file path → routePath + params)

**Files:**
- Create: `packages/inventory/src/route-path.ts`
- Modify: `packages/inventory/src/index.ts`
- Test: `packages/inventory/test/route-path.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/inventory/test/route-path.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { routePathFromFile } from "../src/index.js";

describe("routePathFromFile", () => {
  it("maps a static api route", () => {
    expect(routePathFromFile("app/api/health/route.ts")).toEqual({
      routePath: "/api/health",
      params: [],
    });
  });

  it("maps a dynamic segment", () => {
    expect(routePathFromFile("app/api/orders/[id]/route.ts")).toEqual({
      routePath: "/api/orders/[id]",
      params: ["id"],
    });
  });

  it("maps catch-all and optional catch-all segments", () => {
    expect(routePathFromFile("app/api/docs/[...slug]/route.ts")).toEqual({
      routePath: "/api/docs/[...slug]",
      params: ["slug"],
    });
    expect(routePathFromFile("app/api/files/[[...path]]/route.ts")).toEqual({
      routePath: "/api/files/[[...path]]",
      params: ["path"],
    });
  });

  it("strips route groups and parallel slots", () => {
    expect(routePathFromFile("app/(shop)/api/cart/route.ts")).toEqual({
      routePath: "/api/cart",
      params: [],
    });
    expect(routePathFromFile("app/@modal/api/x/route.ts")).toEqual({
      routePath: "/api/x",
      params: [],
    });
  });

  it("handles root route file", () => {
    expect(routePathFromFile("app/route.ts")).toEqual({ routePath: "/", params: [] });
  });

  it("returns null for non-route files", () => {
    expect(routePathFromFile("app/orders/actions.ts")).toBeNull();
    expect(routePathFromFile("src/api/route.ts")).toBeNull();
  });

  it("accepts js and Windows separators", () => {
    expect(routePathFromFile("app\\api\\ping\\route.js")).toEqual({
      routePath: "/api/ping",
      params: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/inventory/test/route-path.test.ts`
Expected: FAIL — `routePathFromFile` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/inventory/src/route-path.ts`:
```ts
export interface RoutePathInfo {
  routePath: string;
  params: string[];
}

function paramName(segment: string): string | null {
  const m = segment.match(/^\[{1,2}(?:\.\.\.)?([^\].]+)\]{1,2}$/);
  return m ? m[1] : null;
}

export function routePathFromFile(file: string): RoutePathInfo | null {
  const norm = file.replace(/\\/g, "/");
  const m = norm.match(/^app\/(?:(.*)\/)?route\.(ts|tsx|js|jsx)$/);
  if (!m) return null;

  const dir = m[1] ?? "";
  const segments = dir === "" ? [] : dir.split("/");
  const visible = segments.filter(
    (s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"),
  );

  const params: string[] = [];
  for (const seg of visible) {
    const p = paramName(seg);
    if (p !== null) params.push(p);
  }

  return {
    routePath: visible.length === 0 ? "/" : `/${visible.join("/")}`,
    params,
  };
}
```

`packages/inventory/src/index.ts`:
```ts
export * from "./id.js";
export * from "./route-path.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/inventory/test/route-path.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inventory
git commit -m "feat(inventory): map route file paths to route paths and params"
```

---

### Task 3: Route handler extraction (exported HTTP methods)

**Files:**
- Create: `packages/inventory/src/route-handlers.ts`
- Modify: `packages/inventory/src/index.ts`
- Test: `packages/inventory/test/route-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/inventory/test/route-handlers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { extractRouteHandlers } from "../src/index.js";

function sourceFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("app/api/test/route.ts", code);
}

describe("extractRouteHandlers", () => {
  it("finds exported async function declarations", () => {
    const sf = sourceFile(`
      export async function GET(req: Request) { return new Response("ok"); }
      export async function DELETE(req: Request) { return new Response("gone"); }
    `);
    expect(extractRouteHandlers(sf)).toEqual([
      { exportName: "GET", method: "GET" },
      { exportName: "DELETE", method: "DELETE" },
    ]);
  });

  it("finds exported const arrow handlers", () => {
    const sf = sourceFile(`export const POST = async (req: Request) => new Response("ok");`);
    expect(extractRouteHandlers(sf)).toEqual([{ exportName: "POST", method: "POST" }]);
  });

  it("ignores non-method exports", () => {
    const sf = sourceFile(`
      export const dynamic = "force-dynamic";
      export async function GET() { return new Response("ok"); }
      function helper() {}
    `);
    expect(extractRouteHandlers(sf)).toEqual([{ exportName: "GET", method: "GET" }]);
  });

  it("returns empty for files with no handlers", () => {
    const sf = sourceFile(`export const config = {};`);
    expect(extractRouteHandlers(sf)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/inventory/test/route-handlers.test.ts`
Expected: FAIL — `extractRouteHandlers` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/inventory/src/route-handlers.ts`:
```ts
import type { SourceFile } from "ts-morph";
import type { THttpMethod } from "@authzscan/shared";

const HTTP_METHODS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export interface ExtractedHandler {
  exportName: string;
  method: THttpMethod;
}

export function extractRouteHandlers(sf: SourceFile): ExtractedHandler[] {
  const out: ExtractedHandler[] = [];
  for (const [name] of sf.getExportedDeclarations()) {
    if (HTTP_METHODS.includes(name)) {
      out.push({ exportName: name, method: name as THttpMethod });
    }
  }
  return out.sort((a, b) => a.exportName.localeCompare(b.exportName) * -1);
}
```

Note: `getExportedDeclarations()` iterates in alphabetical map order, not source order. The test expects GET before DELETE (source order). Simplest deterministic contract: sort by source position instead. Replace the return with:

```ts
export function extractRouteHandlers(sf: SourceFile): ExtractedHandler[] {
  const out: Array<ExtractedHandler & { pos: number }> = [];
  for (const [name, decls] of sf.getExportedDeclarations()) {
    if (HTTP_METHODS.includes(name)) {
      const pos = decls[0]?.getStart() ?? 0;
      out.push({ exportName: name, method: name as THttpMethod, pos });
    }
  }
  return out
    .sort((a, b) => a.pos - b.pos)
    .map(({ exportName, method }) => ({ exportName, method }));
}
```

Use the source-position version only (the first snippet is shown to explain why; do not keep both).

`packages/inventory/src/index.ts`:
```ts
export * from "./id.js";
export * from "./route-path.js";
export * from "./route-handlers.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/inventory/test/route-handlers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inventory
git commit -m "feat(inventory): extract exported HTTP method handlers from route files"
```

---

### Task 4: Server Action extraction

**Files:**
- Create: `packages/inventory/src/server-actions.ts`
- Modify: `packages/inventory/src/index.ts`
- Test: `packages/inventory/test/server-actions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/inventory/test/server-actions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { extractServerActions } from "../src/index.js";

function sourceFile(code: string, name = "app/orders/actions.ts") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(name, code);
}

describe("extractServerActions", () => {
  it("finds all exported functions in a file-level 'use server' file", () => {
    const sf = sourceFile(`
      "use server";
      export async function deleteOrder(id: string) {}
      export const updateOrder = async (id: string) => {};
      const internal = async () => {};
    `);
    expect(extractServerActions(sf)).toEqual(["deleteOrder", "updateOrder"]);
  });

  it("finds inline 'use server' functions without file directive", () => {
    const sf = sourceFile(`
      export async function notAnAction() {}
      export async function createOrder(data: FormData) {
        "use server";
        return data;
      }
    `);
    expect(extractServerActions(sf)).toEqual(["createOrder"]);
  });

  it("returns empty when no directive anywhere", () => {
    const sf = sourceFile(`export async function plain() {}`);
    expect(extractServerActions(sf)).toEqual([]);
  });

  it("ignores non-function exports in 'use server' files", () => {
    const sf = sourceFile(`
      "use server";
      export const LIMIT = 10;
      export async function act() {}
    `);
    expect(extractServerActions(sf)).toEqual(["act"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/inventory/test/server-actions.test.ts`
Expected: FAIL — `extractServerActions` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/inventory/src/server-actions.ts`:
```ts
import { Node, type SourceFile, type Statement } from "ts-morph";

function isUseServerString(stmt: Statement | undefined): boolean {
  if (!stmt || !Node.isExpressionStatement(stmt)) return false;
  const expr = stmt.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralValue() === "use server";
}

function hasFileDirective(sf: SourceFile): boolean {
  return isUseServerString(sf.getStatements()[0]);
}

function bodyHasDirective(node: Node): boolean {
  if (
    !Node.isFunctionDeclaration(node) &&
    !Node.isArrowFunction(node) &&
    !Node.isFunctionExpression(node)
  ) {
    return false;
  }
  const body = node.getBody();
  if (!body || !Node.isBlock(body)) return false;
  return isUseServerString(body.getStatements()[0]);
}

export function extractServerActions(sf: SourceFile): string[] {
  const fileLevel = hasFileDirective(sf);
  const names: Array<{ name: string; pos: number }> = [];

  for (const [name, decls] of sf.getExportedDeclarations()) {
    for (const d of decls) {
      let fn: Node | undefined;
      if (Node.isFunctionDeclaration(d) || Node.isArrowFunction(d) || Node.isFunctionExpression(d)) {
        fn = d;
      } else if (Node.isVariableDeclaration(d)) {
        const init = d.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) fn = init;
      }
      if (!fn) continue;
      if (fileLevel || bodyHasDirective(fn)) {
        names.push({ name, pos: d.getStart() });
        break;
      }
    }
  }

  return names.sort((a, b) => a.pos - b.pos).map((n) => n.name);
}
```

`packages/inventory/src/index.ts`:
```ts
export * from "./id.js";
export * from "./route-path.js";
export * from "./route-handlers.js";
export * from "./server-actions.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/inventory/test/server-actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inventory
git commit -m "feat(inventory): extract server actions (file-level and inline directives)"
```

---

### Task 5: DB usage + auth indicator detection

**Files:**
- Create: `packages/inventory/src/indicators.ts`
- Modify: `packages/inventory/src/index.ts`
- Test: `packages/inventory/test/indicators.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/inventory/test/indicators.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { usesDb, findAuthIndicators } from "../src/index.js";

function sourceFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("app/api/test/route.ts", code);
}

describe("usesDb", () => {
  it("detects prisma client import", () => {
    const sf = sourceFile(`import { prisma } from "@/lib/prisma";`);
    expect(usesDb(sf)).toBe(true);
  });

  it("detects db module import", () => {
    const sf = sourceFile(`import { db } from "@/lib/db";`);
    expect(usesDb(sf)).toBe(true);
  });

  it("detects prisma property access without import", () => {
    const sf = sourceFile(`export async function GET() { return prisma.order.findMany(); }`);
    expect(usesDb(sf)).toBe(true);
  });

  it("returns false for db-free files", () => {
    const sf = sourceFile(`export async function GET() { return new Response("ok"); }`);
    expect(usesDb(sf)).toBe(false);
  });
});

describe("findAuthIndicators", () => {
  it("finds known auth helper calls, sorted and deduped", () => {
    const sf = sourceFile(`
      import { getServerSession } from "next-auth";
      import { auth } from "@/auth";
      export async function GET() {
        const s1 = await getServerSession();
        const s2 = await getServerSession();
        const s3 = await auth();
      }
    `);
    expect(findAuthIndicators(sf)).toEqual(["auth", "getServerSession"]);
  });

  it("finds method-call helpers like locals.auth()", () => {
    const sf = sourceFile(`export async function GET(ctx: any) { const u = await ctx.currentUser(); }`);
    expect(findAuthIndicators(sf)).toEqual(["currentUser"]);
  });

  it("returns empty when no auth helpers present", () => {
    const sf = sourceFile(`export async function GET() { return new Response("ok"); }`);
    expect(findAuthIndicators(sf)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/inventory/test/indicators.test.ts`
Expected: FAIL — `usesDb` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/inventory/src/indicators.ts`:
```ts
import { Node, type SourceFile } from "ts-morph";

const AUTH_HELPERS: readonly string[] = [
  "getServerSession",
  "auth",
  "currentUser",
  "getUser",
  "getSession",
  "validateRequest",
  "requireUser",
];

const DB_IDENTIFIERS = /^(prisma|db|database)$/;
const DB_MODULE = /prisma|(?:^|\/)db$|(?:^|\/)database$/i;

export function usesDb(sf: SourceFile): boolean {
  for (const imp of sf.getImportDeclarations()) {
    if (DB_MODULE.test(imp.getModuleSpecifierValue())) return true;
  }
  let found = false;
  sf.forEachDescendant((node, traversal) => {
    if (Node.isPropertyAccessExpression(node) && DB_IDENTIFIERS.test(node.getExpression().getText())) {
      found = true;
      traversal.stop();
    }
  });
  return found;
}

export function findAuthIndicators(sf: SourceFile): string[] {
  const found = new Set<string>();
  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    const name = Node.isIdentifier(expr)
      ? expr.getText()
      : Node.isPropertyAccessExpression(expr)
        ? expr.getName()
        : null;
    if (name && AUTH_HELPERS.includes(name)) found.add(name);
  });
  return [...found].sort();
}
```

`packages/inventory/src/index.ts`:
```ts
export * from "./id.js";
export * from "./route-path.js";
export * from "./route-handlers.js";
export * from "./server-actions.js";
export * from "./indicators.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/inventory/test/indicators.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inventory
git commit -m "feat(inventory): detect db usage and auth indicator calls"
```

---

### Task 6: Auth profile builder

**Files:**
- Create: `packages/inventory/src/auth-profile.ts`
- Modify: `packages/inventory/src/index.ts`
- Test: `packages/inventory/test/auth-profile.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/inventory/test/auth-profile.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { detectAuthLibrary, findOwnershipIdioms, buildAuthProfile } from "../src/index.js";

function sourceFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("app/api/test/route.ts", code);
}

describe("detectAuthLibrary", () => {
  it("detects next-auth", () => {
    expect(detectAuthLibrary({ dependencies: { "next-auth": "^5.0.0" } })).toBe("next-auth");
  });

  it("detects clerk", () => {
    expect(detectAuthLibrary({ dependencies: { "@clerk/nextjs": "^6.0.0" } })).toBe("clerk");
  });

  it("detects lucia", () => {
    expect(detectAuthLibrary({ dependencies: { lucia: "^3.0.0" } })).toBe("lucia");
  });

  it("returns unknown when nothing matches", () => {
    expect(detectAuthLibrary({ dependencies: { react: "^19.0.0" } })).toBe("unknown");
  });
});

describe("findOwnershipIdioms", () => {
  it("collects where-clauses that reference ownership keys", () => {
    const sf = sourceFile(`
      const a = prisma.order.findUnique({ where: { id, userId: session.user.id } });
      const b = prisma.order.findUnique({ where: { id } });
    `);
    expect(findOwnershipIdioms(sf)).toEqual(["{ id, userId: session.user.id }"]);
  });

  it("dedupes identical idioms", () => {
    const sf = sourceFile(`
      const a = prisma.x.findFirst({ where: { tenantId: ctx.tenantId } });
      const b = prisma.y.findFirst({ where: { tenantId: ctx.tenantId } });
    `);
    expect(findOwnershipIdioms(sf)).toEqual(["{ tenantId: ctx.tenantId }"]);
  });
});

describe("buildAuthProfile", () => {
  it("upgrades unknown to custom when session patterns exist", () => {
    const profile = buildAuthProfile({
      library: "unknown",
      sessionAccessPatterns: ["validateRequest"],
      ownershipIdioms: [],
    });
    expect(profile.library).toBe("custom");
  });

  it("keeps detected library and passes data through schema validation", () => {
    const profile = buildAuthProfile({
      library: "next-auth",
      sessionAccessPatterns: ["getServerSession"],
      ownershipIdioms: ["{ id, userId: session.user.id }"],
    });
    expect(profile).toEqual({
      library: "next-auth",
      sessionAccessPatterns: ["getServerSession"],
      ownershipIdioms: ["{ id, userId: session.user.id }"],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/inventory/test/auth-profile.test.ts`
Expected: FAIL — `detectAuthLibrary` not exported.

- [ ] **Step 3: Write minimal implementation**

`packages/inventory/src/auth-profile.ts`:
```ts
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
```

`packages/inventory/src/index.ts`:
```ts
export * from "./id.js";
export * from "./route-path.js";
export * from "./route-handlers.js";
export * from "./server-actions.js";
export * from "./indicators.js";
export * from "./auth-profile.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/inventory/test/auth-profile.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inventory
git commit -m "feat(inventory): build auth profile from deps and ownership idioms"
```

---

### Task 7: runInventory orchestrator + fixture repo

**Files:**
- Create: `packages/inventory/src/run.ts`
- Modify: `packages/inventory/src/index.ts`
- Create: `packages/inventory/test/fixtures/basic-app/package.json`
- Create: `packages/inventory/test/fixtures/basic-app/app/api/health/route.ts`
- Create: `packages/inventory/test/fixtures/basic-app/app/api/orders/[id]/route.ts`
- Create: `packages/inventory/test/fixtures/basic-app/app/orders/actions.ts`
- Test: `packages/inventory/test/run.test.ts`

- [ ] **Step 1: Create the fixture repo**

`packages/inventory/test/fixtures/basic-app/package.json`:
```json
{
  "name": "basic-app",
  "private": true,
  "dependencies": {
    "next": "^15.0.0",
    "next-auth": "^5.0.0",
    "@prisma/client": "^6.0.0"
  }
}
```

`packages/inventory/test/fixtures/basic-app/app/api/health/route.ts`:
```ts
export async function GET() {
  return new Response("ok");
}
```

`packages/inventory/test/fixtures/basic-app/app/api/orders/[id]/route.ts`:
```ts
import { prisma } from "../../../../lib/prisma";
import { getServerSession } from "next-auth";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  const order = await prisma.order.findUnique({ where: { id: params.id } });
  return Response.json(order);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await prisma.order.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
}
```

`packages/inventory/test/fixtures/basic-app/app/orders/actions.ts`:
```ts
"use server";

import { prisma } from "../../lib/prisma";
import { getServerSession } from "next-auth";

export async function deleteOrder(id: string) {
  const session = await getServerSession();
  await prisma.order.delete({ where: { id, userId: session.user.id } });
}
```

Note: the fixture intentionally has no `lib/prisma.ts` — ts-morph does not need imports to resolve; `usesDb` works from the import specifier text.

- [ ] **Step 2: Write the failing test**

`packages/inventory/test/run.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runInventory } from "../src/index.js";
import { InventoryResult } from "@authzscan/shared";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "basic-app");

describe("runInventory", () => {
  it("produces a schema-valid InventoryResult", () => {
    const result = runInventory(fixture);
    expect(() => InventoryResult.parse(result)).not.toThrow();
  });

  it("finds all endpoints with correct shapes", () => {
    const result = runInventory(fixture);
    const ids = result.endpoints.map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        "ep_app_api_health_route_ts_get",
        "ep_app_api_orders_id_route_ts_get",
        "ep_app_api_orders_id_route_ts_delete",
        "ep_app_orders_actions_ts_deleteorder",
      ].sort(),
    );

    const orderGet = result.endpoints.find((e) => e.id === "ep_app_api_orders_id_route_ts_get");
    expect(orderGet).toEqual({
      id: "ep_app_api_orders_id_route_ts_get",
      kind: "route-handler",
      file: "app/api/orders/[id]/route.ts",
      method: "GET",
      routePath: "/api/orders/[id]",
      params: ["id"],
      usesDb: true,
      authIndicators: ["getServerSession"],
    });

    const action = result.endpoints.find((e) => e.id === "ep_app_orders_actions_ts_deleteorder");
    expect(action).toEqual({
      id: "ep_app_orders_actions_ts_deleteorder",
      kind: "server-action",
      file: "app/orders/actions.ts",
      method: null,
      routePath: null,
      params: [],
      usesDb: true,
      authIndicators: ["getServerSession"],
    });

    const health = result.endpoints.find((e) => e.id === "ep_app_api_health_route_ts_get");
    expect(health?.usesDb).toBe(false);
    expect(health?.authIndicators).toEqual([]);
  });

  it("builds the auth profile from the fixture", () => {
    const result = runInventory(fixture);
    expect(result.authProfile.library).toBe("next-auth");
    expect(result.authProfile.sessionAccessPatterns).toEqual(["getServerSession"]);
    expect(result.authProfile.ownershipIdioms).toEqual(["{ id, userId: session.user.id }"]);
  });

  it("reports no skipped files for the clean fixture", () => {
    const result = runInventory(fixture);
    expect(result.skippedFiles).toEqual([]);
  });

  it("throws a clear error when app/ is missing", () => {
    expect(() => runInventory(path.dirname(fixture))).toThrow(/no app\/ directory/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/inventory/test/run.test.ts`
Expected: FAIL — `runInventory` not exported.

- [ ] **Step 4: Write minimal implementation**

`packages/inventory/src/run.ts`:
```ts
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
```

`packages/inventory/src/index.ts`:
```ts
export * from "./id.js";
export * from "./route-path.js";
export * from "./route-handlers.js";
export * from "./server-actions.js";
export * from "./indicators.js";
export * from "./auth-profile.js";
export * from "./run.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/inventory/test/run.test.ts`
Expected: PASS (5 tests).

Note: the "throws when app/ missing" test points at `test/fixtures/` (parent of `basic-app`), which has no `app/` dir — if it ever gains one, pick another dir without `app/`.

- [ ] **Step 6: Commit**

```bash
git add packages/inventory
git commit -m "feat(inventory): add runInventory orchestrator with fixture integration test"
```

---

### Task 8: Full-suite verification

**Files:** none new.

- [ ] **Step 1: Run complete test suite**

Run: `pnpm test`
Expected: PASS — Plan 01's 28 tests + 39 inventory tests (id 4, route-path 7, route-handlers 4, server-actions 4, indicators 7, auth-profile 8, run 5) = 67 total, all green.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit any stragglers**

```bash
git add -A
git commit -m "chore: inventory plan complete - parser green"
```

---

## Spec coverage map (Plan 02 slice)

| Spec requirement | Task |
|---|---|
| Route handler detection (`app/**/route.ts\|js`, method exports) | 2, 3 |
| Server Action detection (file-level + inline `'use server'`) | 4 |
| Dynamic segments (`[id]`, `[...slug]`) | 2 |
| usesDb via Prisma refs | 5 |
| Auth-wrapper presence (known helpers) | 5 |
| Auth-context profile (library, session patterns, ownership idioms) | 6, 7 |
| Per-file parse failure → skippedFiles, never silent | 7 |
| Repo-level fail (no `app/`) → clear error | 7 |
| ts-morph, no regex code parsing | all |
| Output zod-validated | 7 |

Deferred: middleware matcher detection (spec mentions it; v1 value low until engine consumes it — folded into Plan 03 prompt context instead). CLI wiring of inventory phase → Plan 03 (`.authzscan/inventory.json` artifact belongs with the phase runner).
