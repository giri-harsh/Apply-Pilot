// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { LiveCapError, createCappedFetch } from "../live/cap";

describe("live-suite call cap", () => {
  const make = (max: number) => {
    let n = 0;
    const fetchImpl = vi.fn(async () => new Response("{}"));
    return { fetchImpl, f: createCappedFetch({ max, read: () => n, write: (v) => (n = v), fetchImpl }), count: () => n };
  };

  it("allows exactly `max` requests and throws before any network traffic after that", async () => {
    const t = make(2);
    await t.f("https://x.test/a", {});
    await t.f("https://x.test/b", {});
    await expect(t.f("https://x.test/c", {})).rejects.toBeInstanceOf(LiveCapError);
    expect(t.fetchImpl).toHaveBeenCalledTimes(2);
    expect(t.count()).toBe(2);
  });

  it("a cap of 0 sends nothing, and a failing request still uses budget", async () => {
    const zero = make(0);
    await expect(zero.f("https://x.test", {})).rejects.toThrow(/cap reached/);
    expect(zero.fetchImpl).not.toHaveBeenCalled();
    const one = make(1);
    one.fetchImpl.mockRejectedValueOnce(new Error("network"));
    await expect(one.f("https://x.test", {})).rejects.toThrow("network");
    await expect(one.f("https://x.test", {})).rejects.toBeInstanceOf(LiveCapError);
  });

  it("the error message carries no URL, header or body", async () => {
    const t = make(0);
    await expect(t.f("https://secret.example/?key=abc", { headers: { authorization: "Bearer k" }, body: "prompt" })).rejects.toSatisfy((e: Error) => !/secret|abc|Bearer|prompt/.test(e.message));
  });
});
