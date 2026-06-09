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
