import {
  CSV_COLUMNS,
  type IntentType,
  type NormalizeResult,
  type ParseCsvResult,
  type RawCsvRow,
  type RowError,
  type ScheduleSpec,
} from "./types.js";
import { parseSchedule } from "./schedule.js";

const VALID_TYPES: readonly IntentType[] = ["pay", "request", "subscription"];
const QUSDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// CSV text parsing (deterministic, RFC-4180-ish: quotes, escaped quotes, CRLF)
// ---------------------------------------------------------------------------

/** Tokenize CSV text into records (arrays of string fields). */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawAny = false;

  const pushField = (): void => {
    record.push(field);
    field = "";
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    sawAny = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else if (ch === "\r") {
      // swallow; the following \n (if any) ends the record
    } else {
      field += ch;
    }
  }
  // Flush trailing field/record unless the file ended exactly on a newline.
  if (field !== "" || record.length > 0) {
    pushRecord();
  } else if (sawAny && records.length === 0) {
    pushRecord();
  }
  return records;
}

/** True when a record is entirely empty (blank line / trailing newline). */
function isBlankRecord(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

/**
 * Parse raw CSV text into rows. Returns a `fileError` ONLY when the file is
 * structurally unparseable (no header, or missing a required column). Per-row
 * problems are never surfaced here — they are caught later by `normalizeRow`.
 */
export function parseCsvRows(text: string): ParseCsvResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    return { rows: [], fileError: "The file is empty." };
  }

  const header = (records[0] ?? []).map((c) => c.trim().toLowerCase());
  const colIndex: Partial<Record<(typeof CSV_COLUMNS)[number], number>> = {};
  for (const col of CSV_COLUMNS) {
    const idx = header.indexOf(col);
    if (idx !== -1) colIndex[col] = idx;
  }
  // type/recipient/amount are required columns; memo/schedule are optional.
  for (const required of ["type", "recipient", "amount"] as const) {
    if (colIndex[required] === undefined) {
      return {
        rows: [],
        fileError: `Missing required column "${required}". Expected header: ${CSV_COLUMNS.join(",")}.`,
      };
    }
  }

  const cell = (cells: string[], col: (typeof CSV_COLUMNS)[number]): string => {
    const idx = colIndex[col];
    if (idx === undefined) return "";
    return cells[idx] ?? "";
  };

  const rows: RawCsvRow[] = [];
  let rowIndex = 0;
  for (let i = 1; i < records.length; i++) {
    const cells = records[i] ?? [];
    if (isBlankRecord(cells)) continue; // skip blank lines silently
    rows.push({
      rowIndex,
      type: cell(cells, "type"),
      recipient: cell(cells, "recipient"),
      amount: cell(cells, "amount"),
      memo: cell(cells, "memo"),
      schedule: cell(cells, "schedule"),
    });
    rowIndex++;
  }
  return { rows };
}

// ---------------------------------------------------------------------------
// Amount + memo normalization
// ---------------------------------------------------------------------------

export type AmountParseResult = { ok: true; value: bigint } | { ok: false; message: string };

/**
 * Parse a human QUSDC amount string ("10", "0.50") into 6-decimal base units,
 * deterministically. Rejects empty, non-numeric, negative, zero, and
 * over-precise (> 6 dp) inputs. No floating point is used.
 */
export function parseQusdcAmount(input: string): AmountParseResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, message: "Amount is required." };
  if (!/^\d*(\.\d+)?$/.test(trimmed) || trimmed === ".") {
    return { ok: false, message: `Invalid amount "${input.trim()}".` };
  }
  const [wholeRaw, frac = ""] = trimmed.split(".");
  if (frac.length > QUSDC_DECIMALS) {
    return { ok: false, message: `Amount "${input.trim()}" has more than ${QUSDC_DECIMALS} decimal places.` };
  }
  const whole = wholeRaw === undefined || wholeRaw === "" ? "0" : wholeRaw;
  const fracPadded = (frac + "000000").slice(0, QUSDC_DECIMALS);
  const value = BigInt(whole) * 1_000_000n + BigInt(fracPadded || "0");
  if (value <= 0n) return { ok: false, message: "Amount must be greater than zero." };
  return { ok: true, value };
}

/** Collapse internal whitespace and trim. Used everywhere a memo is hashed. */
export function normalizeMemo(memo: string): string {
  return memo.trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

/**
 * Validate + normalize one raw CSV row. Collects ALL per-row problems (so the
 * UI can show them together) and never throws. `schedule` is only valid for
 * `subscription` rows and is required for them.
 */
export function normalizeRow(raw: RawCsvRow): NormalizeResult {
  const errors: RowError[] = [];

  const type = raw.type.trim().toLowerCase() as IntentType;
  if (!VALID_TYPES.includes(type)) {
    errors.push({
      rowIndex: raw.rowIndex,
      field: "type",
      message: `Unsupported type "${raw.type.trim()}". Use one of: ${VALID_TYPES.join(", ")}.`,
    });
  }

  const recipientInput = raw.recipient.trim();
  if (recipientInput === "") {
    errors.push({ rowIndex: raw.rowIndex, field: "recipient", message: "Recipient is required." });
  }

  const amount = parseQusdcAmount(raw.amount);
  if (!amount.ok) {
    errors.push({ rowIndex: raw.rowIndex, field: "amount", message: amount.message });
  }

  const memo = normalizeMemo(raw.memo);

  const hasSchedule = raw.schedule.trim() !== "";
  let scheduleSpec: ScheduleSpec | null = null;
  if (type === "subscription") {
    const parsed = parseSchedule(raw.schedule);
    if (!parsed.ok) {
      errors.push({ rowIndex: raw.rowIndex, field: "schedule", message: parsed.message });
    } else {
      scheduleSpec = parsed.spec;
    }
  } else if (hasSchedule) {
    errors.push({
      rowIndex: raw.rowIndex,
      field: "schedule",
      message: `Schedule is only valid for subscription rows (got type "${type}").`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    row: {
      rowIndex: raw.rowIndex,
      type,
      recipientInput,
      amount: (amount as { ok: true; value: bigint }).value,
      memo,
      scheduleSpec,
    },
  };
}
