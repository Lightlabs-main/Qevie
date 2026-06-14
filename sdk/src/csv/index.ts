/**
 * Bulk Intent Import — pure, deterministic, environment-agnostic helpers.
 *
 * No network, no LLM, no on-chain calls live here. The paymaster-service and the
 * app both import these so parsing, normalization, hashing, dedup, policy
 * mirroring, and id derivation behave identically everywhere and stay testable.
 */

export * from "./types.js";
export { parseSchedule, type ScheduleParseResult } from "./schedule.js";
export {
  parseCsvRows,
  normalizeRow,
  parseQusdcAmount,
  normalizeMemo,
  type AmountParseResult,
} from "./normalize.js";
export {
  computeIntentKey,
  computeContentKey,
  lowerAddress,
  type ContentKeyInput,
} from "./keys.js";
export {
  detectDuplicates,
  severityForType,
  highestSeverity,
} from "./dedupe.js";
export { previewPolicyForRows } from "./policy.js";
export {
  deterministicBatchId,
  chunk,
  selectExecutableRows,
  MAX_BATCH_RECIPIENTS,
  DEFAULT_BATCH_CHUNK_SIZE,
  type SelectOptions,
} from "./compose.js";
