import { describe, expect, it } from "vitest";
import { parseAgentCommand } from "./parser.js";
import { validateIntent } from "./validator.js";
import type { BatchIntent, SendIntent, SubscriptionIntent } from "./types.js";

describe("parseAgentCommand", () => {
  it("parses a simple send", () => {
    const r = parseAgentCommand("Pay alice 5 QUSDC");
    expect(r.kind).toBe("send");
    const s = r as SendIntent;
    expect(s.recipientInput.toLowerCase()).toBe("alice");
    expect(s.amount).toBe("5");
  });

  it("parses an amount-first send with 'to'", () => {
    const r = parseAgentCommand("send 5 QUSDC to bob");
    expect(r.kind).toBe("send");
    expect((r as SendIntent).recipientInput.toLowerCase()).toBe("bob");
  });

  it("parses a multi-recipient batch", () => {
    const r = parseAgentCommand("Pay Ada 5 QUSDC and Sam 8 QUSDC");
    expect(r.kind).toBe("batch");
    const b = r as BatchIntent;
    expect(b.payments).toHaveLength(2);
    expect(b.payments[0]?.amount).toBe("5");
    expect(b.payments[1]?.amount).toBe("8");
  });

  it("parses a payment request with memo", () => {
    const r = parseAgentCommand("Request 15 QUSDC from Tobi for lunch");
    expect(r.kind).toBe("payment_request");
    if (r.kind === "payment_request") {
      expect(r.amount).toBe("15");
      expect(r.fromInput?.toLowerCase()).toBe("tobi");
      expect(r.memo).toBe("lunch");
    }
  });

  it("parses a payment link command", () => {
    const r = parseAgentCommand("Create a payment link for 30 QUSDC for design work");
    expect(r.kind).toBe("payment_link");
    if (r.kind === "payment_link") {
      expect(r.amount).toBe("30");
      expect(r.memo).toBe("design work");
    }
  });

  it("parses a recurring subscription with a .qie recipient", () => {
    const r = parseAgentCommand("Pay designer.qie 10 QUSDC every Friday for 4 weeks");
    expect(r.kind).toBe("subscription");
    const s = r as SubscriptionIntent;
    expect(s.recipientInput).toBe("designer.qie");
    expect(s.amount).toBe("10");
    expect(s.period).toBe("week");
    expect(s.maxRuns).toBe(4);
    // "every Friday" anchors the first charge to the next Friday (a future
    // timestamp), so the subscription never charges on the day it's created.
    expect(s.startAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(new Date(s.startAt! * 1000).getDay()).toBe(5);
  });

  it("leaves startAt unset for a non-weekday recurrence", () => {
    const r = parseAgentCommand("Pay alice 5 QUSDC every week");
    expect(r.kind).toBe("subscription");
    expect((r as SubscriptionIntent).startAt).toBeUndefined();
  });

  it("blocks an ambiguous batch with no concrete recipients", () => {
    const r = parseAgentCommand("Batch pay my contributors 20 QUSDC each");
    expect(r.kind).toBe("clarification");
  });

  it("asks for clarification on empty input", () => {
    expect(parseAgentCommand("").kind).toBe("clarification");
  });

  it("asks for clarification on unrecognized input", () => {
    expect(parseAgentCommand("what is the weather").kind).toBe("clarification");
  });
});

describe("validateIntent", () => {
  it("rejects a zero amount", () => {
    const result = validateIntent({ kind: "send", recipientInput: "alice", amount: "0" });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed send", () => {
    const result = validateIntent({ kind: "send", recipientInput: "alice", amount: "5" });
    expect(result.ok).toBe(true);
  });
});
