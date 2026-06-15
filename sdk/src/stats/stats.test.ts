import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsModule, STATS_NOT_CONFIGURED_MESSAGE } from "./index.js";

function mockFetchOnce(body: unknown, ok = true, status = 200): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok,
        status,
        json: async () => body,
      } as Response;
    }),
  );
  return calls;
}

describe("StatsModule", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects with a clear message when no API URL is configured", async () => {
    const stats = new StatsModule(undefined);
    await expect(stats.getProtocolStats({})).rejects.toThrow(STATS_NOT_CONFIGURED_MESSAGE);
    const empty = new StatsModule("");
    await expect(empty.getMyStats({ smartAccount: "0xabc" as `0x${string}` })).rejects.toThrow(
      STATS_NOT_CONFIGURED_MESSAGE,
    );
  });

  it("fetches protocol stats from the configured base, trimming a trailing slash", async () => {
    const calls = mockFetchOnce({ chainId: 1990, overview: {} });
    const stats = new StatsModule("https://api.example/");
    const res = await stats.getProtocolStats({ period: "24h" });
    expect(res.chainId).toBe(1990);
    expect(calls[0]).toBe("https://api.example/api/protocol/stats?period=24h");
  });

  it("passes event-type filters through the query string", async () => {
    const calls = mockFetchOnce({ chainId: 1990, events: [] });
    const stats = new StatsModule("https://api.example");
    await stats.getProtocolEvents({ limit: 10, types: ["PAYMENT_EXECUTED", "BATCH_EXECUTED"] });
    expect(calls[0]).toContain("/api/protocol/events?");
    expect(calls[0]).toContain("limit=10");
    expect(calls[0]).toContain("types=PAYMENT_EXECUTED%2CBATCH_EXECUTED");
  });

  it("scopes my-stats and my-events to the smartAccount", async () => {
    const calls = mockFetchOnce({ chainId: 1990, events: [] });
    const stats = new StatsModule("https://api.example");
    await stats.getMyEvents({ smartAccount: "0xABC123" as `0x${string}`, limit: 5 });
    expect(calls[0]).toContain("/api/me/events?");
    expect(calls[0]).toContain("smartAccount=0xABC123");
    expect(calls[0]).toContain("limit=5");
  });

  it("surfaces a server error message", async () => {
    mockFetchOnce({ error: "boom" }, false, 500);
    const stats = new StatsModule("https://api.example");
    await expect(stats.getProtocolStats({})).rejects.toThrow("boom");
  });
});
