/**
 * Qevie sustainable gas model.
 *
 * Qevie does not make gas disappear — it abstracts it. There are four explicit
 * execution states:
 *
 *   SPONSORED_ONBOARDING — the first 3 eligible ops per smart account are
 *                          sponsored by the Qevie paymaster (a strict onboarding
 *                          quota, not unlimited free gas).
 *   QUSDC_GAS            — after the quota, the paymaster fronts native QIE gas
 *                          and charges the user in QUSDC, priced along the
 *                          QIEDex WQIE/QUSDC route. Available to any user who
 *                          holds enough QUSDC and has approved the paymaster.
 *   NATIVE_QIE           — the user/account pays its own gas in native QIE.
 *   PAUSED               — no valid gas route; do not submit a UserOperation.
 *
 * This module is a thin, read-only decision layer over the on-chain paymaster
 * views (`remainingFreeOps`, `qusdcGasAvailable`, `getQusdcGasStatus`,
 * `quoteQUSDC`). It maps cleanly onto the low-level `GasMode`
 * ("sponsored" | "qusdc" | "self") used when building UserOperations.
 */

import type { Address, PublicClient } from "viem";
import { PAYMASTER_ABI } from "./abis.js";
import type { GasMode } from "./types.js";
import type { QevieContracts } from "./contracts.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = PublicClient<any, any, any>;

/** The four explicit gas states the app and Autopilot understand. */
export type QevieGasMode =
  | "SPONSORED_ONBOARDING"
  | "QUSDC_GAS"
  | "NATIVE_QIE"
  | "PAUSED";

/** Map a high-level gas mode to the low-level builder GasMode. */
export function toBuilderGasMode(mode: QevieGasMode): GasMode | null {
  switch (mode) {
    case "SPONSORED_ONBOARDING":
      return "sponsored";
    case "QUSDC_GAS":
      return "qusdc";
    case "NATIVE_QIE":
      return "self";
    case "PAUSED":
      return null;
  }
}

export interface SponsoredStatus {
  used: number;
  limit: number;
  remaining: number;
}

export interface QusdcGasQuote {
  available: boolean;
  /** QUSDC (6-dec) that would be charged for the worst-case gas cost. */
  quotedQusdc: bigint;
  /** Human-readable QUSDC amount, e.g. "0.04". */
  quotedQusdcFormatted: string;
  /** Empty when available, else why QUSDC_GAS is unavailable. */
  reason: string;
  /** Pricing route shown to the user. */
  route: string[];
}

export interface GasModeOption {
  mode: QevieGasMode;
  available: boolean;
  /** Empty when available, else why this mode is currently unavailable. */
  reason: string;
}

/**
 * Structured gas decision — returned by the Paymaster decision layer and the
 * Autopilot executor. Never claims unlimited free gas.
 */
export interface AutopilotGasDecision {
  mode: QevieGasMode;
  sponsoredUsed: number;
  sponsoredLimit: number;
  sponsoredRemaining: number;
  estimatedQusdcGas?: string;
  maxQusdcGasPerTx?: string;
  dailyQusdcGasCap?: string;
  dailyQusdcGasUsed?: string;
  qieDexRoute?: string[];
  reasons: string[];
}

/** Per-policy gas preferences governing how the decision is made. */
export interface GasPolicyPrefs {
  allowSponsoredGas: boolean;
  allowQusdcGas: boolean;
  allowNativeQieFallback: boolean;
  pauseWhenGasUnavailable: boolean;
}

/**
 * Worst-case gas cost (wei) used to quote QUSDC_GAS for an established account.
 * ~600k gas at 1 gwei. Overridable per call. Unused gas is never billed; this
 * only bounds the validation/display quote.
 */
export const DEFAULT_MAX_GAS_COST_WEI = 600_000n * 1_000_000_000n;

function formatQusdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole.toString()}.${fraction}`;
}

/**
 * Read-only gas decision module. Exposed on the client as `client.gas`.
 */
export class GasModule {
  constructor(
    private readonly publicClient: AnyPublicClient,
    private readonly contracts: QevieContracts,
  ) {}

  /** Remaining sponsored onboarding quota for a smart account. */
  async getSponsoredStatus(smartAccount: Address): Promise<SponsoredStatus> {
    let limit = 3;
    let remaining = 0;
    try {
      const [rem, cap] = await Promise.all([
        this.publicClient.readContract({
          address: this.contracts.paymaster,
          abi: PAYMASTER_ABI,
          functionName: "remainingFreeOps",
          args: [smartAccount],
        }) as Promise<bigint>,
        this.publicClient.readContract({
          address: this.contracts.paymaster,
          abi: PAYMASTER_ABI,
          functionName: "PER_ACCOUNT_CAP",
        }) as Promise<bigint>,
      ]);
      remaining = Number(rem);
      limit = Number(cap);
    } catch {
      /* paymaster unreachable — treat as no sponsored quota */
    }
    return { used: Math.max(0, limit - remaining), limit, remaining };
  }

  /**
   * Quote QUSDC_GAS for an account: whether it can pay gas in QUSDC right now
   * and how much would be charged. A funded user (holds QUSDC + has approved the
   * paymaster) is always available — there is no per-user cap by default.
   */
  async quoteQusdcGas(
    smartAccount: Address,
    maxGasCostWei: bigint = DEFAULT_MAX_GAS_COST_WEI,
  ): Promise<QusdcGasQuote> {
    try {
      const [available, quoted, reason] = (await this.publicClient.readContract({
        address: this.contracts.paymaster,
        abi: PAYMASTER_ABI,
        functionName: "qusdcGasAvailable",
        args: [smartAccount, maxGasCostWei],
      })) as [boolean, bigint, string];
      return {
        available,
        quotedQusdc: quoted,
        quotedQusdcFormatted: formatQusdc(quoted),
        reason,
        route: ["WQIE", "QUSDC"],
      };
    } catch {
      return {
        available: false,
        quotedQusdc: 0n,
        quotedQusdcFormatted: "0",
        reason: "QUSDC Gas pricing is unavailable (paymaster or QIEDex route unreachable)",
        route: ["WQIE", "QUSDC"],
      };
    }
  }

  /**
   * The two user-facing gas modes for the payment app: SPONSORED_ONBOARDING
   * (first 3 ops) then QUSDC_GAS. Qevie is a payment app — after onboarding you
   * pay network fees in QUSDC. If QUSDC_GAS is unavailable (no QUSDC balance or
   * the paymaster hasn't been approved), the caller should prompt the user to
   * add/approve QUSDC. NATIVE_QIE is not offered as a normal user path.
   */
  async getGasModeOptions(
    smartAccount: Address,
    maxGasCostWei: bigint = DEFAULT_MAX_GAS_COST_WEI,
  ): Promise<GasModeOption[]> {
    const [sponsored, qusdc] = await Promise.all([
      this.getSponsoredStatus(smartAccount),
      this.quoteQusdcGas(smartAccount, maxGasCostWei),
    ]);
    return [
      {
        mode: "SPONSORED_ONBOARDING",
        available: sponsored.remaining > 0,
        reason: sponsored.remaining > 0 ? "" : "Sponsored onboarding quota used (3/3)",
      },
      {
        mode: "QUSDC_GAS",
        available: qusdc.available,
        reason: qusdc.available ? "" : qusdc.reason,
      },
    ];
  }

  /**
   * Resolve the gas mode to use for the next op given policy preferences.
   * Mirrors the Autopilot executor's decision so the app and agents agree.
   * Returns a structured decision; `mode === "PAUSED"` means do not submit.
   */
  async resolveGasMode(
    smartAccount: Address,
    // Default: the payment-app model — sponsored onboarding, then QUSDC gas.
    // No native-QIE fallback by default; if QUSDC gas is unavailable the user
    // needs QUSDC. (Autopilot may opt into native fallback explicitly.)
    prefs: GasPolicyPrefs = {
      allowSponsoredGas: true,
      allowQusdcGas: true,
      allowNativeQieFallback: false,
      pauseWhenGasUnavailable: true,
    },
    maxGasCostWei: bigint = DEFAULT_MAX_GAS_COST_WEI,
  ): Promise<AutopilotGasDecision> {
    const reasons: string[] = [];
    const sponsored = await this.getSponsoredStatus(smartAccount);

    const base: AutopilotGasDecision = {
      mode: "PAUSED",
      sponsoredUsed: sponsored.used,
      sponsoredLimit: sponsored.limit,
      sponsoredRemaining: sponsored.remaining,
      reasons,
    };

    if (prefs.allowSponsoredGas && sponsored.remaining > 0) {
      return { ...base, mode: "SPONSORED_ONBOARDING" };
    }
    if (sponsored.remaining === 0) reasons.push("Sponsored onboarding quota exhausted (3/3)");

    if (prefs.allowQusdcGas) {
      const quote = await this.quoteQusdcGas(smartAccount, maxGasCostWei);
      if (quote.available) {
        return {
          ...base,
          mode: "QUSDC_GAS",
          estimatedQusdcGas: quote.quotedQusdcFormatted,
          qieDexRoute: quote.route,
        };
      }
      reasons.push(`QUSDC Gas unavailable: ${quote.reason}`);
    } else {
      reasons.push("QUSDC Gas disabled by policy");
    }

    if (prefs.allowNativeQieFallback) {
      return { ...base, mode: "NATIVE_QIE" };
    }
    reasons.push("Native QIE fallback disabled by policy");

    // No route. Pause is the safe default for automation.
    return base;
  }
}
