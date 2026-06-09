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

  it("finds method-call helpers like ctx.currentUser()", () => {
    const sf = sourceFile(`export async function GET(ctx: any) { const u = await ctx.currentUser(); }`);
    expect(findAuthIndicators(sf)).toEqual(["currentUser"]);
  });

  it("returns empty when no auth helpers present", () => {
    const sf = sourceFile(`export async function GET() { return new Response("ok"); }`);
    expect(findAuthIndicators(sf)).toEqual([]);
  });
});
