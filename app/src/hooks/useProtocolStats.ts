/**
 * Data hooks for the protocol-stats surfaces. Each polls the indexer-backed
 * stats API and degrades to a clear error/empty state when the API is
 * unreachable (the indexer may still be syncing) — never to fabricated data.
 */

import { useEffect, useRef, useState } from "react";
import type {
  MyStatsResponse,
  ProtocolStatsResponse,
  QevieProtocolEvent,
  QevieProtocolEventType,
} from "../lib/statsClient.js";
import { statsClient } from "../lib/statsClient.js";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const DEFAULT_POLL_MS = 20_000;

export function useProtocolStats(pollMs = DEFAULT_POLL_MS): AsyncState<ProtocolStatsResponse> {
  const [state, setState] = useState<AsyncState<ProtocolStatsResponse>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;
    const load = async (): Promise<void> => {
      try {
        const data = await statsClient.getProtocolStats({});
        if (mounted) setState({ data, loading: false, error: null });
      } catch (e) {
        if (mounted) {
          setState((prev) => ({
            data: prev.data,
            loading: false,
            error: e instanceof Error ? e.message : "Stats unavailable",
          }));
        }
      }
    };
    void load();
    const id = setInterval(() => { void load(); }, pollMs);
    return () => { mounted = false; clearInterval(id); };
  }, [pollMs]);

  return state;
}

export function useProtocolEvents(
  opts: { limit?: number; types?: QevieProtocolEventType[]; pollMs?: number; paused?: boolean } = {},
): AsyncState<QevieProtocolEvent[]> {
  const { limit = 50, types, pollMs = DEFAULT_POLL_MS, paused = false } = opts;
  const [state, setState] = useState<AsyncState<QevieProtocolEvent[]>>({
    data: null,
    loading: true,
    error: null,
  });
  // Keep the latest `paused` without re-subscribing the interval each toggle.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const typesKey = types?.join(",") ?? "";

  useEffect(() => {
    let mounted = true;
    const load = async (): Promise<void> => {
      if (pausedRef.current) return;
      try {
        const res = await statsClient.getProtocolEvents({
          limit,
          ...(types !== undefined && types.length > 0 ? { types } : {}),
        });
        if (mounted) setState({ data: res.events, loading: false, error: null });
      } catch (e) {
        if (mounted) {
          setState((prev) => ({
            data: prev.data,
            loading: false,
            error: e instanceof Error ? e.message : "Feed unavailable",
          }));
        }
      }
    };
    void load();
    const id = setInterval(() => { void load(); }, pollMs);
    return () => { mounted = false; clearInterval(id); };
  }, [limit, typesKey, types, pollMs]);

  return state;
}

export function useMyStats(smartAccount: string | null, pollMs = DEFAULT_POLL_MS): AsyncState<MyStatsResponse> {
  const [state, setState] = useState<AsyncState<MyStatsResponse>>({
    data: null,
    loading: smartAccount !== null,
    error: null,
  });

  useEffect(() => {
    if (smartAccount === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let mounted = true;
    const load = async (): Promise<void> => {
      try {
        const data = await statsClient.getMyStats({ smartAccount: smartAccount as `0x${string}` });
        if (mounted) setState({ data, loading: false, error: null });
      } catch (e) {
        if (mounted) {
          setState((prev) => ({
            data: prev.data,
            loading: false,
            error: e instanceof Error ? e.message : "Stats unavailable",
          }));
        }
      }
    };
    void load();
    const id = setInterval(() => { void load(); }, pollMs);
    return () => { mounted = false; clearInterval(id); };
  }, [smartAccount, pollMs]);

  return state;
}
