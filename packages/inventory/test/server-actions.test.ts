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
