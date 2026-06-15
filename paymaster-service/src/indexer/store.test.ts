import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QevieProtocolEvent } from "@qevie/sdk";

// Point the store at an isolated temp file BEFORE importing it (the store reads
// the path lazily per call, but setting it up front keeps the test hermetic).
const dir = mkdtempSync(join(tmpdir(), "qevie-store-"));
process.env["PROTOCOL_EVENTS_STORE_PATH"] = join(dir, "events.json");
process.env["PROTOCOL_EVENTS_MAX"] = "5000";

const { upsertEvents, queryEvents, loadEvents } = await import("./store.js");

const CHAIN = 1990;
function ev(id: string, partial: Partial<QevieProtocolEvent> & Pick<QevieProtocolEvent, "type">): QevieProtocolEvent {
  return {
    id,
    chainId: CHAIN,
    status: "confirmed",
    timestamp: 1_900_000_000,
    ...partial,
  } as QevieProtocolEvent;
}

describe("protocol event store", () => {
  beforeAll(() => {
    // Seed a mixed set, including a duplicate id (same tx + logIndex).
    upsertEvents([
      ev("1990:0xabc:0", { type: "PAYMENT_EXECUTED", amountQusdc: "1000000", smartAccount: "0xaa" as `0x${string}`, timestamp: 100 }),
      ev("1990:0xabc:0", { type: "PAYMENT_EXECUTED", amountQusdc: "1000000", smartAccount: "0xaa" as `0x${string}`, timestamp: 100 }),
      ev("1990:0xdef:1", { type: "BATCH_EXECUTED", amountQusdc: "2000000", timestamp: 200 }),
      ev("1983:0xttt:0", { type: "PAYMENT_EXECUTED", amountQusdc: "9000000", timestamp: 300, chainId: 1983 }),
    ]);
  });

  afterAll(() => {
    delete process.env["PROTOCOL_EVENTS_STORE_PATH"];
    delete process.env["PROTOCOL_EVENTS_MAX"];
  });

  it("dedupes by id so the same tx/logIndex is never double-counted", () => {
    const all = loadEvents();
    const ids = all.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.filter((e) => e.id === "1990:0xabc:0")).toHaveLength(1);
  });

  it("filters by chainId (no cross-chain bleed)", () => {
    const mainnet = queryEvents({ chainId: 1990 });
    expect(mainnet.every((e) => e.chainId === 1990)).toBe(true);
    expect(mainnet.find((e) => e.id === "1983:0xttt:0")).toBeUndefined();
  });

  it("filters by type and smartAccount", () => {
    const byType = queryEvents({ chainId: 1990, types: ["BATCH_EXECUTED"] });
    expect(byType).toHaveLength(1);
    expect(byType[0]?.type).toBe("BATCH_EXECUTED");

    const byAcct = queryEvents({ chainId: 1990, smartAccount: "0xAA" as `0x${string}` });
    expect(byAcct.every((e) => e.smartAccount?.toLowerCase() === "0xaa")).toBe(true);
  });

  it("returns newest first and respects limit", () => {
    const rows = queryEvents({ chainId: 1990, limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("1990:0xdef:1"); // timestamp 200 > 100
  });
});
