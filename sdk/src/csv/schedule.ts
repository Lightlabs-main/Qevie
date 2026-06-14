import type { ScheduleKind, ScheduleSpec } from "./types.js";

/**
 * Deterministic schedule parsing for `subscription` rows.
 *
 * The design doc permits an LLM ONLY to turn a freeform `schedule` cell into a
 * structured spec, and ONLY behind a deterministic validator. We implement just
 * the deterministic validator here — no LLM in the money path. A freeform string
 * that this parser does not understand is a row error, never a guess.
 */

const DAY = 86_400;
const WEEK = 604_800;
/** 30-day canonical month — deterministic, matches how subscriptions count periods. */
const MONTH = 30 * DAY;

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const WEEKDAY_ABBR: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};

export type ScheduleParseResult =
  | { ok: true; spec: ScheduleSpec }
  | { ok: false; message: string };

function spec(kind: ScheduleKind, periodSeconds: number, canonical: string, dayOfWeek?: number): ScheduleSpec {
  return {
    kind,
    periodSeconds,
    canonical,
    ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
  };
}

function weekday(token: string): number | null {
  if (token in WEEKDAYS) return WEEKDAYS[token] as number;
  if (token in WEEKDAY_ABBR) return WEEKDAY_ABBR[token] as number;
  return null;
}

/**
 * Parse a human schedule cell into a structured, canonical spec. Recognizes a
 * small, explicit grammar; anything else fails cleanly so the row is rejected at
 * intake rather than silently mis-scheduled.
 */
export function parseSchedule(input: string): ScheduleParseResult {
  const raw = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (raw === "") {
    return { ok: false, message: "Schedule is required for subscription rows." };
  }

  // "every <weekday>" / "<weekday>" / "every friday"
  const everyWeekday = raw.replace(/^every\s+/, "");
  const wd = weekday(everyWeekday);
  if (wd !== null) {
    return { ok: true, spec: spec("weekly", WEEK, `weekly:${wd}`, wd) };
  }

  if (raw === "daily" || raw === "every day") {
    return { ok: true, spec: spec("daily", DAY, "daily") };
  }
  if (raw === "weekly" || raw === "every week") {
    return { ok: true, spec: spec("weekly", WEEK, "weekly") };
  }
  if (raw === "monthly" || raw === "every month") {
    return { ok: true, spec: spec("monthly", MONTH, "monthly") };
  }

  // "every N days" / "every N weeks"
  const everyN = raw.match(/^every\s+(\d+)\s+(day|days|week|weeks)$/);
  if (everyN !== null) {
    const n = Number(everyN[1]);
    if (n >= 1) {
      const unit = everyN[2] as string;
      if (unit.startsWith("day")) {
        return { ok: true, spec: spec("daily", n * DAY, `daily:${n}`) };
      }
      return { ok: true, spec: spec("weekly", n * WEEK, `weekly:every:${n}`) };
    }
  }

  return {
    ok: false,
    message: `Unrecognized schedule "${input.trim()}". Use e.g. "every Friday", "weekly", "daily", "monthly", or "every 2 weeks".`,
  };
}
