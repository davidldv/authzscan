import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/index.js";

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to N times with backoff then succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("boom1"))
      .mockRejectedValueOnce(new Error("boom2"))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    await expect(withRetry(fn, { retries: 2, delayMs: 0 })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
