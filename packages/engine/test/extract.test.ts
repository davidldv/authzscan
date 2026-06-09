import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson } from "../src/index.js";

const Schema = z.array(z.object({ id: z.string() }));

describe("extractJson", () => {
  it("parses a fenced json block", () => {
    const text = 'Here you go:\n```json\n[{"id": "a"}]\n```\nDone.';
    expect(extractJson(text, Schema)).toEqual([{ id: "a" }]);
  });

  it("parses bare JSON output", () => {
    expect(extractJson('[{"id": "a"}]', Schema)).toEqual([{ id: "a" }]);
  });

  it("parses JSON embedded in prose via bracket scan", () => {
    const text = 'Findings below.\n[{"id": "a"}, {"id": "b"}]\nThat is all.';
    expect(extractJson(text, Schema)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("throws a descriptive error on invalid JSON", () => {
    expect(() => extractJson("no json here", Schema)).toThrow(/no JSON value found/i);
  });

  it("throws schema errors for valid JSON of the wrong shape", () => {
    expect(() => extractJson('[{"wrong": 1}]', Schema)).toThrow(/invalid/i);
  });
});
