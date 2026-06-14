import { describe, it, expect } from "vitest";
import type { Address, Hex } from "viem";
import { parseCsvRows, normalizeRow, parseQusdcAmount, normalizeMemo } from "./normalize.js";
import { parseSchedule } from "./schedule.js";
import { computeIntentKey, computeContentKey } from "./keys.js";
import { detectDuplicates, highestSeverity, severityForType } from "./dedupe.js";
import { previewPolicyForRows } from "./policy.js";
import { deterministicBatchId, chunk, selectExecutableRows } from "./compose.js";
import type {
  DedupeRow,
  PolicyMirror,
  RawCsvRow,
  SelectableIntent,
} from "./types.js";

const SMART: Address = "0x1111111111111111111111111111111111111111";
const TOKEN: Address = "0x2222222222222222222222222222222222222222";
const ALICE: Address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB: Address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const EXAMPLE_CSV = `type,recipient,amount,memo,schedule
pay,designer.qie,10,UI work,
pay,writer.qie,15,Article payment,
request,tobi.qie,5,Lunch,
subscription,dev.qie,20,Weekly dev,every Friday`;

function raw(partial: Partial<RawCsvRow>): RawCsvRow {
  return {
    rowIndex: 0,
    type: "pay",
    recipient: "alice.qie",
    amount: "10",
    memo: "",
    schedule: "",
    ...partial,
  };
}

function dedupeRow(partial: Partial<DedupeRow> & { rowIndex: number }): DedupeRow {
  const resolvedAddress = (partial.resolvedAddress ?? ALICE).toLowerCase() as Address;
  const type = partial.type ?? "pay";
  const amount = partial.amount ?? 10_000_000n;
  const memo = partial.memo ?? "";
  const contentKey =
    partial.contentKey ??
    computeContentKey({
      smartAccount: SMART,
      resolvedAddress,
      token: TOKEN,
      amount,
      normalizedMemo: memo,
      scheduleSpec: "",
    });
  return {
    rowIndex: partial.rowIndex,
    type,
    resolvedAddress,
    amount,
    memo,
    contentKey,
    recipientInput: partial.recipientInput ?? "alice.qie",
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parseCsvRows", () => {
  it("parses the example CSV into 4 data rows", () => {
    const { rows, fileError } = parseCsvRows(EXAMPLE_CSV);
    expect(fileError).toBeUndefined();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ rowIndex: 0, type: "pay", recipient: "designer.qie", amount: "10" });
    expect(rows[3]).toMatchObject({ type: "subscription", schedule: "every Friday" });
  });

  it("skips blank lines without erroring", () => {
    const { rows } = parseCsvRows("type,recipient,amount,memo,schedule\n\npay,alice.qie,1,,\n\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowIndex).toBe(0);
  });

  it("honors quoted fields containing commas", () => {
    const { rows } = parseCsvRows('type,recipient,amount,memo,schedule\npay,alice.qie,1,"hello, world",');
    expect(rows[0]?.memo).toBe("hello, world");
  });

  it("rejects the whole file when a required column is missing", () => {
    const { rows, fileError } = parseCsvRows("type,amount\npay,1");
    expect(rows).toHaveLength(0);
    expect(fileError).toMatch(/recipient/);
  });

  it("tolerates reordered columns", () => {
    const { rows } = parseCsvRows("amount,recipient,type\n5,bob.qie,request");
    expect(rows[0]).toMatchObject({ type: "request", recipient: "bob.qie", amount: "5" });
  });
});

// ---------------------------------------------------------------------------
// Amount + memo + normalization
// ---------------------------------------------------------------------------

describe("parseQusdcAmount", () => {
  it("converts human amounts to 6-dec base units", () => {
    expect(parseQusdcAmount("10")).toEqual({ ok: true, value: 10_000_000n });
    expect(parseQusdcAmount("0.5")).toEqual({ ok: true, value: 500_000n });
    expect(parseQusdcAmount("0.000001")).toEqual({ ok: true, value: 1n });
  });

  it("rejects zero, negative, non-numeric, and over-precise amounts", () => {
    expect(parseQusdcAmount("0").ok).toBe(false);
    expect(parseQusdcAmount("-1").ok).toBe(false);
    expect(parseQusdcAmount("abc").ok).toBe(false);
    expect(parseQusdcAmount("1.2345678").ok).toBe(false);
    expect(parseQusdcAmount("").ok).toBe(false);
  });
});

describe("normalizeMemo", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeMemo("  hello   world \n")).toBe("hello world");
  });
});

describe("normalizeRow", () => {
  it("normalizes a valid pay row", () => {
    const res = normalizeRow(raw({ type: "PAY", amount: "10", memo: "  UI  work " }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.row.type).toBe("pay");
      expect(res.row.amount).toBe(10_000_000n);
      expect(res.row.memo).toBe("UI work");
      expect(res.row.scheduleSpec).toBeNull();
    }
  });

  it("rejects an unsupported type", () => {
    const res = normalizeRow(raw({ type: "withdraw" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.field).toBe("type");
  });

  it("rejects a missing recipient and bad amount together", () => {
    const res = normalizeRow(raw({ recipient: "  ", amount: "nope" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const fields = res.errors.map((e) => e.field);
      expect(fields).toContain("recipient");
      expect(fields).toContain("amount");
    }
  });

  it("rejects a schedule on a non-subscription row", () => {
    const res = normalizeRow(raw({ type: "pay", schedule: "weekly" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.field).toBe("schedule");
  });

  it("requires a schedule for subscription rows and parses it", () => {
    expect(normalizeRow(raw({ type: "subscription", schedule: "" })).ok).toBe(false);
    const res = normalizeRow(raw({ type: "subscription", schedule: "every Friday" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.scheduleSpec?.canonical).toBe("weekly:5");
  });
});

describe("parseSchedule", () => {
  it("maps weekday phrases deterministically", () => {
    const r = parseSchedule("every Friday");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec).toMatchObject({ kind: "weekly", dayOfWeek: 5, periodSeconds: 604_800 });
  });
  it("supports daily/weekly/monthly and 'every N weeks'", () => {
    expect(parseSchedule("daily").ok).toBe(true);
    expect(parseSchedule("monthly").ok).toBe(true);
    const n = parseSchedule("every 2 weeks");
    expect(n.ok).toBe(true);
    if (n.ok) expect(n.spec.periodSeconds).toBe(2 * 604_800);
  });
  it("rejects gibberish rather than guessing", () => {
    expect(parseSchedule("whenever I feel like it").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

describe("computeIntentKey", () => {
  it("is deterministic and unique per (job,row)", () => {
    expect(computeIntentKey("job-1", 0)).toBe(computeIntentKey("job-1", 0));
    expect(computeIntentKey("job-1", 0)).not.toBe(computeIntentKey("job-1", 1));
    expect(computeIntentKey("job-1", 0)).not.toBe(computeIntentKey("job-2", 0));
  });
});

describe("computeContentKey", () => {
  const base = {
    smartAccount: SMART,
    resolvedAddress: ALICE,
    token: TOKEN,
    amount: 10_000_000n,
    normalizedMemo: "rent",
    scheduleSpec: "",
  };
  it("is deterministic", () => {
    expect(computeContentKey(base)).toBe(computeContentKey({ ...base }));
  });
  it("is insensitive to address casing (resolution collisions collapse)", () => {
    expect(computeContentKey(base)).toBe(
      computeContentKey({ ...base, resolvedAddress: ALICE.toUpperCase().replace("0X", "0x") as Address }),
    );
  });
  it("changes when memo or amount changes", () => {
    expect(computeContentKey(base)).not.toBe(computeContentKey({ ...base, normalizedMemo: "lunch" }));
    expect(computeContentKey(base)).not.toBe(computeContentKey({ ...base, amount: 11_000_000n }));
  });
});

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

describe("detectDuplicates", () => {
  it("flags same-file exact duplicates and blocks pay rows", () => {
    const rows = [dedupeRow({ rowIndex: 0 }), dedupeRow({ rowIndex: 1 })];
    const w = detectDuplicates(rows);
    const sameFile = w.filter((x) => x.check === "same_file");
    expect(sameFile).toHaveLength(2);
    expect(sameFile.every((x) => x.severity === "block")).toBe(true);
    expect(sameFile[0]?.relatedRows).toEqual([1]);
  });

  it("treats duplicate requests as soft warnings, not blocks", () => {
    const rows = [
      dedupeRow({ rowIndex: 0, type: "request" }),
      dedupeRow({ rowIndex: 1, type: "request" }),
    ];
    const w = detectDuplicates(rows).filter((x) => x.check === "same_file");
    expect(w.every((x) => x.severity === "warn")).toBe(true);
  });

  it("flags same recipient + amount when only the memo differs", () => {
    const rows = [
      dedupeRow({ rowIndex: 0, memo: "rent" }),
      dedupeRow({ rowIndex: 1, memo: "RENT march" }),
    ];
    const w = detectDuplicates(rows);
    expect(w.some((x) => x.check === "same_recipient_amount")).toBe(true);
    expect(w.some((x) => x.check === "same_file")).toBe(false);
  });

  it("detects resolution collisions (different input → same address)", () => {
    const rows = [
      dedupeRow({ rowIndex: 0, recipientInput: "designer.qie", resolvedAddress: ALICE, amount: 10_000_000n, memo: "a" }),
      dedupeRow({ rowIndex: 1, recipientInput: ALICE, resolvedAddress: ALICE, amount: 99_000_000n, memo: "b" }),
    ];
    const w = detectDuplicates(rows).filter((x) => x.check === "resolution_collision");
    expect(w).toHaveLength(2);
    expect(w.every((x) => x.severity === "warn")).toBe(true);
  });

  it("flags history hits within the lookback set", () => {
    const row = dedupeRow({ rowIndex: 0 });
    const w = detectDuplicates([row], { historyContentKeys: [row.contentKey] });
    expect(w.some((x) => x.check === "history")).toBe(true);
  });

  it("reports no warnings for genuinely distinct rows", () => {
    const rows = [
      dedupeRow({ rowIndex: 0, resolvedAddress: ALICE }),
      dedupeRow({ rowIndex: 1, resolvedAddress: BOB, recipientInput: "bob.qie" }),
    ];
    expect(detectDuplicates(rows)).toHaveLength(0);
  });
});

describe("severity helpers", () => {
  it("severityForType is rail-aware", () => {
    expect(severityForType("pay")).toBe("block");
    expect(severityForType("subscription")).toBe("block");
    expect(severityForType("request")).toBe("warn");
  });
  it("highestSeverity picks block over warn", () => {
    expect(
      highestSeverity([
        { rowIndex: 0, check: "history", severity: "warn", message: "" },
        { rowIndex: 0, check: "same_file", severity: "block", message: "" },
      ]),
    ).toBe("block");
    expect(highestSeverity([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Policy preview
// ---------------------------------------------------------------------------

function policy(partial: Partial<PolicyMirror> = {}): PolicyMirror {
  return {
    active: true,
    guardianRevoked: false,
    validAfter: 0n,
    validUntil: 0n,
    maxPerTx: 100_000_000n,
    dailyLimit: 0n,
    weeklyLimit: 0n,
    totalLimit: 0n,
    spentToday: 0n,
    spentThisWeek: 0n,
    spentTotal: 0n,
    allowSinglePayment: true,
    allowPaymentRequest: true,
    allowSubscription: true,
    allowBatchPayment: true,
    ...partial,
  };
}

describe("previewPolicyForRows", () => {
  const NOW = 1_700_000_000;

  it("marks an in-policy row valid", () => {
    const [res] = previewPolicyForRows(
      policy(),
      [{ rowIndex: 0, type: "pay", amount: 10_000_000n, recipientAllowed: true }],
      NOW,
    );
    expect(res?.status).toBe("valid");
  });

  it("blocks a recipient not on the allowlist", () => {
    const [res] = previewPolicyForRows(
      policy(),
      [{ rowIndex: 0, type: "pay", amount: 10_000_000n, recipientAllowed: false }],
      NOW,
    );
    expect(res?.status).toBe("blocked");
    expect(res?.reasons.join(" ")).toMatch(/allowlist/);
  });

  it("blocks an amount over max-per-tx and a disallowed rail", () => {
    const over = previewPolicyForRows(
      policy({ maxPerTx: 5_000_000n }),
      [{ rowIndex: 0, type: "pay", amount: 10_000_000n, recipientAllowed: true }],
      NOW,
    );
    expect(over[0]?.status).toBe("blocked");
    const rail = previewPolicyForRows(
      policy({ allowSubscription: false }),
      [{ rowIndex: 0, type: "subscription", amount: 1_000_000n, recipientAllowed: true }],
      NOW,
    );
    expect(rail[0]?.status).toBe("blocked");
  });

  it("flags (not blocks) when the cumulative daily budget is exceeded", () => {
    const res = previewPolicyForRows(
      policy({ dailyLimit: 15_000_000n }),
      [
        { rowIndex: 0, type: "pay", amount: 10_000_000n, recipientAllowed: true },
        { rowIndex: 1, type: "pay", amount: 10_000_000n, recipientAllowed: true },
      ],
      NOW,
    );
    expect(res[0]?.status).toBe("valid");
    expect(res[1]?.status).toBe("needs_review");
  });

  it("blocks an expired or revoked policy", () => {
    expect(
      previewPolicyForRows(
        policy({ validUntil: BigInt(NOW - 1) }),
        [{ rowIndex: 0, type: "pay", amount: 1n, recipientAllowed: true }],
        NOW,
      )[0]?.status,
    ).toBe("blocked");
    expect(
      previewPolicyForRows(
        policy({ guardianRevoked: true }),
        [{ rowIndex: 0, type: "pay", amount: 1n, recipientAllowed: true }],
        NOW,
      )[0]?.status,
    ).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// Compose + idempotency selection
// ---------------------------------------------------------------------------

describe("deterministicBatchId", () => {
  it("is stable per (job,chunk) and varies by chunk", () => {
    expect(deterministicBatchId("job", 0)).toBe(deterministicBatchId("job", 0));
    expect(deterministicBatchId("job", 0)).not.toBe(deterministicBatchId("job", 1));
  });
});

describe("chunk", () => {
  it("splits and clamps to the on-chain cap", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk(Array.from({ length: 250 }, (_, i) => i), 1000)).toHaveLength(2); // clamped to 200
  });
});

describe("selectExecutableRows (idempotency + duplicate gate)", () => {
  function intent(partial: Partial<SelectableIntent> & { rowIndex: number }): SelectableIntent {
    return {
      rowIndex: partial.rowIndex,
      intentKey: (partial.intentKey ?? computeIntentKey("job", partial.rowIndex)) as Hex,
      type: partial.type ?? "pay",
      status: partial.status ?? "valid",
      policyStatus: partial.policyStatus ?? "valid",
      duplicateSeverity: partial.duplicateSeverity ?? null,
    };
  }

  it("submits ZERO ops for already-confirmed intentKeys (resume-safe)", () => {
    const rows = [intent({ rowIndex: 0 }), intent({ rowIndex: 1 })];
    const out = selectExecutableRows(rows, {
      allowDuplicateRows: false,
      isAutopilot: false,
      confirmedIntentKeys: [rows[0]!.intentKey],
    });
    expect(out.map((r) => r.rowIndex)).toEqual([1]);
  });

  it("never re-submits executing/confirmed rows, retries failed rows", () => {
    const rows = [
      intent({ rowIndex: 0, status: "confirmed" }),
      intent({ rowIndex: 1, status: "executing" }),
      intent({ rowIndex: 2, status: "failed" }),
      intent({ rowIndex: 3, status: "valid" }),
    ];
    const out = selectExecutableRows(rows, { allowDuplicateRows: false, isAutopilot: false });
    expect(out.map((r) => r.rowIndex)).toEqual([2, 3]);
  });

  it("skips blocked / needs_review policy rows", () => {
    const rows = [
      intent({ rowIndex: 0, policyStatus: "blocked" }),
      intent({ rowIndex: 1, policyStatus: "needs_review" }),
      intent({ rowIndex: 2, policyStatus: "valid" }),
    ];
    const out = selectExecutableRows(rows, { allowDuplicateRows: false, isAutopilot: false });
    expect(out.map((r) => r.rowIndex)).toEqual([2]);
  });

  it("blocks duplicate pay rows by default; allows warn-level duplicates", () => {
    const rows = [
      intent({ rowIndex: 0, duplicateSeverity: "block" }),
      intent({ rowIndex: 1, duplicateSeverity: "warn" }),
    ];
    const out = selectExecutableRows(rows, { allowDuplicateRows: false, isAutopilot: false });
    expect(out.map((r) => r.rowIndex)).toEqual([1]);
  });

  it("lets a user opt into blocking duplicates, but NEVER Autopilot", () => {
    const rows = [intent({ rowIndex: 0, duplicateSeverity: "block" })];
    expect(
      selectExecutableRows(rows, { allowDuplicateRows: true, isAutopilot: false }).map((r) => r.rowIndex),
    ).toEqual([0]);
    expect(
      selectExecutableRows(rows, { allowDuplicateRows: true, isAutopilot: true }),
    ).toHaveLength(0);
  });
});
