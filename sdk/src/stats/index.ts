/**
 * Qevie Protocol Stats — SDK read client.
 *
 * Thin, typed wrapper over the paymaster-service `/api/protocol/*` and
 * `/api/me/*` endpoints. Reads only — it never writes or fakes data. When no
 * stats API URL is configured for the active network, every method rejects with
 * a clear, actionable error instead of crashing or returning made-up numbers.
 */

import type { Address } from "viem";
import type {
  MyStatsResponse,
  ProtocolEventsResponse,
  ProtocolStatsResponse,
  QevieProtocolEventType,
  StatsPeriod,
} from "./types.js";

export type {
  QevieProtocolEvent,
  QevieProtocolEventType,
  QevieProtocolEventStatus,
  QevieGasModeLabel,
  StatsPeriod,
  ProtocolOverview,
  ProtocolAutopilotStats,
  ProtocolPaymentStats,
  ProtocolPaymasterStats,
  ProtocolReceiptStats,
  ProtocolDomainStats,
  ProtocolStatsResponse,
  ProtocolEventsResponse,
  MyStatsResponse,
} from "./types.js";

const NOT_CONFIGURED = "Stats API is not configured for this network.";
const REQUEST_TIMEOUT_MS = 8_000;

export class StatsModule {
  constructor(private readonly statsApiUrl: string | undefined) {}

  private base(): string {
    if (this.statsApiUrl === undefined || this.statsApiUrl === "") {
      throw new Error(NOT_CONFIGURED);
    }
    return this.statsApiUrl.replace(/\/$/, "");
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error("Stats request timed out.");
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      let message = `Stats request failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (typeof body.error === "string") message = body.error;
      } catch {
        /* keep default */
      }
      throw new Error(message);
    }
    return (await res.json()) as T;
  }

  async getProtocolStats(opts: { period?: StatsPeriod } = {}): Promise<ProtocolStatsResponse> {
    const q = opts.period ? `?period=${encodeURIComponent(opts.period)}` : "";
    return this.get<ProtocolStatsResponse>(`/api/protocol/stats${q}`);
  }

  async getProtocolEvents(
    opts: { limit?: number; types?: QevieProtocolEventType[] } = {},
  ): Promise<ProtocolEventsResponse> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts.types !== undefined && opts.types.length > 0) {
      params.set("types", opts.types.join(","));
    }
    const q = params.toString();
    return this.get<ProtocolEventsResponse>(`/api/protocol/events${q ? `?${q}` : ""}`);
  }

  async getMyStats(opts: { smartAccount: Address }): Promise<MyStatsResponse> {
    return this.get<MyStatsResponse>(
      `/api/me/stats?smartAccount=${encodeURIComponent(opts.smartAccount)}`,
    );
  }

  async getMyEvents(opts: {
    smartAccount: Address;
    limit?: number;
    types?: QevieProtocolEventType[];
  }): Promise<ProtocolEventsResponse> {
    const params = new URLSearchParams({ smartAccount: opts.smartAccount });
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts.types !== undefined && opts.types.length > 0) {
      params.set("types", opts.types.join(","));
    }
    return this.get<ProtocolEventsResponse>(`/api/me/events?${params.toString()}`);
  }
}

export const STATS_NOT_CONFIGURED_MESSAGE = NOT_CONFIGURED;
