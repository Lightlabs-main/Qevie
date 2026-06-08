import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { gaslessParams, type GaslessResolution } from "./gasless.js";

/**
 * Minimal client surface this hook needs. Typed structurally so it accepts the
 * QevieClient instance regardless of which bundled SDK copy produced its type.
 */
interface GasStatusClient {
  getAllowlistToken(smart: Address): Promise<unknown>;
  isQusdcGasReady(smart: Address): Promise<boolean>;
  ensureQusdcGasReady(
    signer: unknown,
  ): Promise<{ armed: boolean; alreadyArmed: boolean; reason?: string }>;
  publicClient: { readContract(args: unknown): Promise<unknown> };
}

export interface GasStatus extends GaslessResolution {
  loading: boolean;
  /** True while the one-time paymaster approval (arming) is in flight. */
  arming: boolean;
  /** True once the paymaster is approved to pull QUSDC for gas. */
  armed: boolean;
}

/**
 * Live gas status for the current smart account: which mode the next op will
 * use (sponsored onboarding → QUSDC gas), the sponsored quota remaining, and
 * the estimated QUSDC gas charge. While the account still has sponsored ops, it
 * also arms the one-time paymaster approval in the background so that QUSDC gas
 * works seamlessly once onboarding is used up.
 */
export function useGasStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  signer: unknown,
  address: Address | null,
): GasStatus & { refresh: () => void } {
  const [status, setStatus] = useState<GasStatus>({
    loading: true,
    arming: false,
    armed: false,
    mode: "sponsored",
    uiMode: "SPONSORED_ONBOARDING",
    sponsoredRemaining: 0,
  });
  const armingRef = useRef(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (address === null) return;
    let mounted = true;
    const c = client as GasStatusClient;

    void (async () => {
      try {
        const [resolution, armed] = await Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          gaslessParams(client as any, address),
          c.isQusdcGasReady(address).catch(() => false),
        ]);
        if (!mounted) return;
        setStatus((s) => ({ ...s, ...resolution, armed, loading: false }));

        // Arm QUSDC gas once, during the sponsored window, so it's ready when
        // onboarding runs out. Skip if already armed or no sponsored route.
        if (
          !armed &&
          signer !== null &&
          resolution.uiMode === "SPONSORED_ONBOARDING" &&
          !armingRef.current
        ) {
          armingRef.current = true;
          setStatus((s) => ({ ...s, arming: true }));
          try {
            const res = await c.ensureQusdcGasReady(signer);
            if (mounted) setStatus((s) => ({ ...s, arming: false, armed: res.armed }));
          } catch {
            if (mounted) setStatus((s) => ({ ...s, arming: false }));
          } finally {
            armingRef.current = false;
          }
        }
      } catch {
        if (mounted) setStatus((s) => ({ ...s, loading: false }));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [client, signer, address, tick]);

  return { ...status, refresh };
}

/** Format a 6-dec QUSDC amount for display, e.g. 21600n → "0.0216". */
export function formatQusdc(amount: bigint | undefined): string {
  if (amount === undefined) return "0";
  const whole = amount / 1_000_000n;
  const frac = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole.toString()}.${frac}`;
}
