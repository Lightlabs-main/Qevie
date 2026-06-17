import type { QevieClient, SubscriptionRecord } from "@qevie/sdk";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Human label for a subscription period in seconds. */
export function frequencyLabel(seconds: number): string {
  if (seconds === 86_400) return "Daily";
  if (seconds === 604_800) return "Weekly";
  if (seconds === 2_592_000) return "Monthly";
  const days = Math.round(seconds / 86_400);
  return days <= 1 ? `Every ${seconds}s` : `Every ${days} days`;
}

/** Display status for a subscription record. */
export function subStatus(sub: SubscriptionRecord): { label: string; cls: string } {
  if (!sub.active) return { label: "Cancelled", cls: "status-warn" };
  if (sub.maxPayments > 0n && sub.paymentsMade >= sub.maxPayments) {
    return { label: "Completed", cls: "text-muted" };
  }
  return { label: "Active", cls: "status-good" };
}

/** A subscription can still be cancelled (active and not fully paid out). */
export function isCancellable(sub: SubscriptionRecord): boolean {
  return sub.active && !(sub.maxPayments > 0n && sub.paymentsMade >= sub.maxPayments);
}

/**
 * Enumerate a payer's subscriptions. SubscriptionManager exposes no list view
 * or event in the ABI, and subIds are a sequential counter, so we walk ids from
 * 1 and stop after a run of empties (past the global max). Bounded so a large
 * global count can't hang the page — a server-side index can replace this later.
 */
export async function loadSubscriptionsFor(
  client: Pick<QevieClient, "getSubscription">,
  owner: string,
): Promise<SubscriptionRecord[]> {
  const found: SubscriptionRecord[] = [];
  let consecutiveEmpty = 0;
  for (let id = 1; id <= 250 && consecutiveEmpty < 6; id++) {
    let sub: SubscriptionRecord | null = null;
    try {
      sub = await client.getSubscription(BigInt(id));
    } catch {
      sub = null;
    }
    if (sub === null || sub.payer.toLowerCase() === ZERO_ADDRESS) {
      consecutiveEmpty += 1;
      continue;
    }
    consecutiveEmpty = 0;
    if (sub.payer.toLowerCase() === owner.toLowerCase()) found.push(sub);
  }
  return found;
}
