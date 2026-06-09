import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { ArtifactStore } from "../src/index.js";

const Shape = z.object({ value: z.number() });
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "authzscan-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ArtifactStore", () => {
  it("round-trips a validated artifact", () => {
    const store = new ArtifactStore(dir);
    store.write("inventory", { value: 42 });
    expect(store.read("inventory", Shape)).toEqual({ value: 42 });
  });

  it("returns null for missing artifacts", () => {
    const store = new ArtifactStore(dir);
    expect(store.read("candidates", Shape)).toBeNull();
  });

  it("returns null (not garbage) for corrupt artifacts", () => {
    const store = new ArtifactStore(dir);
    store.writeRaw("findings", "{not json");
    expect(store.read("findings", Shape)).toBeNull();
  });

  it("returns null for schema-invalid artifacts", () => {
    const store = new ArtifactStore(dir);
    store.write("inventory", { wrong: true });
    expect(store.read("inventory", Shape)).toBeNull();
  });

  it("creates the .authzscan directory under the target dir", () => {
    const store = new ArtifactStore(dir);
    store.write("inventory", { value: 1 });
    expect(store.path("inventory")).toBe(path.join(dir, ".authzscan", "inventory.json"));
  });
});
