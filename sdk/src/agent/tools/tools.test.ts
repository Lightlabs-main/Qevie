import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, toolForIntent, planToolsForIntent } from "./index.js";
import type { MultiStepIntent } from "../intent/types.js";

describe("agent tool registry", () => {
  it("exposes every named tool", () => {
    expect(Object.keys(AGENT_TOOLS).sort()).toEqual(
      [
        "batch_pay_qusdc",
        "create_payment_link",
        "create_payment_request",
        "create_receipt",
        "create_subscription",
        "read_passport",
        "send_qusdc",
      ].sort(),
    );
  });

  it("maps each single intent to its rail tool", () => {
    expect(toolForIntent({ kind: "send", recipientInput: "a", amount: "1" })).toBe("send_qusdc");
    expect(toolForIntent({ kind: "batch", payments: [] })).toBe("batch_pay_qusdc");
    expect(toolForIntent({ kind: "payment_link" })).toBe("create_payment_link");
    expect(toolForIntent({ kind: "payment_request", amount: "1" })).toBe("create_payment_request");
    expect(
      toolForIntent({ kind: "subscription", recipientInput: "a", amount: "1", period: "week", intervalSeconds: 604800 }),
    ).toBe("create_subscription");
  });

  it("plans a tool per step for a multi-step intent", () => {
    const multi: MultiStepIntent = {
      kind: "multi_step",
      rawInput: "...",
      warnings: [],
      steps: [
        { kind: "send", recipientInput: "a", amount: "1" },
        { kind: "payment_request", amount: "2" },
      ],
    };
    expect(planToolsForIntent(multi)).toEqual(["send_qusdc", "create_payment_request"]);
  });

  it("each tool name matches its registry key", () => {
    for (const [key, tool] of Object.entries(AGENT_TOOLS)) {
      expect(tool.name).toBe(key);
    }
  });
});
