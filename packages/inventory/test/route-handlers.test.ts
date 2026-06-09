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
