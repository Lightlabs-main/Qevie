import {
  BATCH_PAYMENTS_ABI,
  PAYMENT_REQUEST_ABI,
  type QevieProtocolEvent,
  type QevieProtocolEventType,
} from "@qevie/sdk";
import {
  type Address,
  type Hash,
  hexToString,
  parseAbiItem,
} from "viem";
import { APP_CONFIG } from "../config.js";
import { statsClient } from "./statsClient.js";

const LINKS_STORAGE_KEY = "qevie_history_links_v1";
const HISTORY_BLOCK_WINDOW = 60_000n;
const FEED_BLOCK_WINDOW = 20_000n;
// The QIE mainnet RPC rejects getLogs ranges wider than ~10k blocks, so every
// scan has to page. A 10_000-block span (the proven ceiling) keeps chunk count
// low; 9_999 makes the inclusive [from,to] span exactly 10_000 blocks.
const MAX_LOG_BLOCK_SPAN = 9_999n;

// Each log chunk answers in ~1.5-2s, and the old code paged sequentially, so a
// multi-scan view (requests, feed) ran dozens of round-trips back-to-back and
// blew past the page load timeout. We now fetch chunks in parallel, but cap the
// total in-flight log queries across every concurrent scan: firing all of them
// at once gets throttled by the RPC. This gate bounds global concurrency.
const MAX_CONCURRENT_LOG_QUERIES = 8;
let activeLogQueries = 0;
const logQueryWaiters: Array<() => void> = [];

async function withLogQuerySlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeLogQueries >= MAX_CONCURRENT_LOG_QUERIES) {
    await new Promise<void>((resolve) => logQueryWaiters.push(resolve));
  }
  activeLogQueries += 1;
  try {
    return await run();
  } finally {
    activeLogQueries -= 1;
    const next = logQueryWaiters.shift();
    if (next !== undefined) next();
  }
}

function blockRanges(fromBlock: bigint, toBlock: bigint): Array<{ from: bigint; to: bigint }> {
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_BLOCK_SPAN + 1n) {
    ranges.push({ from: start, to: minBigInt(start + MAX_LOG_BLOCK_SPAN, toBlock) });
  }
  return ranges;
}

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export interface StoredLinkHistory {
  id: string;
  label: string;
  uri: string;
  shareUrl: string;
  to: string;
  targetAddress: string | null;
  amount: string | null;
  expiry: string | null;
  maxUses: number | null;
  createdAt: number;
  status: "paid" | "unpaid";
  txHash: string | null;
  paidAt: number | null;
}

export interface LinkHistoryItem {
  id: string;
  label: string;
  uri: string;
  shareUrl: string;
  to: string;
  targetAddress: string | null;
  amount: bigint | null;
  createdAt: number;
  expiry: string | null;
  maxUses: number | null;
  status: "paid" | "unpaid";
  txHash: string | null;
  paidAt: number | null;
}

export interface RequestHistoryItem {
  requestId: bigint;
  requestor: Address;
  payer: Address;
  amount: bigint;
  memo: string;
  expiry: bigint;
  status: "paid" | "unpaid" | "cancelled";
  createdAt: number;
  createdTxHash: Hash | null;
  settledTxHash: Hash | null;
}

export interface BatchHistoryItem {
  batchId: string;
  sender: Address;
  recipients: Address[];
  amounts: bigint[];
  totalAmount: bigint;
  createdAt: number;
  txHash: Hash | null;
}

export interface FeedItem {
  id: string;
  kind: "request_created" | "request_paid" | "batch_paid" | "transfer_received" | "transfer_sent" | "transfer_internal";
  title: string;
  subtitle: string;
  amount: bigint;
  timestamp: number;
  txHash: Hash | null;
}

/**
 * A single row in the indexed activity stream. The server-side indexer
 * (`/api/me/events`, `/api/protocol/events`) returns normalized, already-confirmed
 * protocol events instantly, so the History overview no longer depends on the slow
 * client-side log scans (which time out against the QIE RPC). The detailed
 * per-type tabs still use those scans on demand, since the index doesn't carry
 * per-domain detail like a created-but-unpaid request or a link's share URL.
 */
export interface ActivityItem {
  id: string;
  type: QevieProtocolEventType;
  title: string;
  subtitle: string;
  amount: bigint | null;
  status: "pending" | "confirmed" | "failed";
  timestamp: number;
  txHash: Hash | null;
}

const ACTIVITY_LABELS: Record<QevieProtocolEventType, string> = {
  POLICY_CREATED: "Autopilot policy created",
  POLICY_PENDING: "Autopilot policy pending",
  POLICY_REVOKED: "Autopilot policy revoked",
  GUARDIAN_REVOKED: "Guardian revoked a policy",
  SESSION_EXECUTED: "Autopilot payment",
  SESSION_BATCH_EXECUTED: "Autopilot batch payout",
  PAYMENT_EXECUTED: "Payment sent",
  BATCH_EXECUTED: "Batch payout",
  REQUEST_SETTLED: "Payment request settled",
  SUBSCRIPTION_EXECUTED: "Subscription charge",
  PAYMASTER_SPONSORED: "Gas sponsored",
  QUSDC_GAS_CHARGED: "Gas paid in QUSDC",
  RECEIPT_CREATED: "Receipt created",
  DOMAIN_RESOLVED: "Domain resolved",
  DOMAIN_RESOLUTION_FAILED: "Domain resolution failed",
};

function toActivityItem(e: QevieProtocolEvent): ActivityItem {
  const amount = e.amountQusdc !== undefined && e.amountQusdc !== ""
    ? safeBigInt(e.amountQusdc)
    : null;
  const detail = e.qieDomainInput ?? (e.smartAccount ? shortAddress(e.smartAccount) : "");
  return {
    id: e.id,
    type: e.type,
    title: ACTIVITY_LABELS[e.type] ?? e.type,
    subtitle: e.reason ?? detail,
    amount,
    status: e.status,
    timestamp: e.timestamp > 0 ? e.timestamp * 1000 : 0,
    txHash: (e.txHash ?? null) as Hash | null,
  };
}

function safeBigInt(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * The user's recent activity, served from the indexer — instant and reliable.
 * Returns [] (not throwing) when the stats API is unconfigured/unreachable so the
 * page degrades to the on-demand scans rather than erroring.
 */
export async function getIndexedActivity(address: Address | null): Promise<ActivityItem[]> {
  if (address === null) return [];
  const res = await statsClient.getMyEvents({ smartAccount: address, limit: 200 });
  return res.events.map(toActivityItem);
}

const FEED_KIND: Partial<Record<QevieProtocolEventType, FeedItem["kind"]>> = {
  BATCH_EXECUTED: "batch_paid",
  SESSION_BATCH_EXECUTED: "batch_paid",
  REQUEST_SETTLED: "request_paid",
  PAYMENT_EXECUTED: "transfer_sent",
  SESSION_EXECUTED: "transfer_sent",
  SUBSCRIPTION_EXECUTED: "transfer_sent",
};

/** Protocol-wide live feed, served from the indexer. */
export async function getIndexedFeed(): Promise<FeedItem[]> {
  const res = await statsClient.getProtocolEvents({ limit: 50 });
  return res.events.map((e) => {
    const item = toActivityItem(e);
    return {
      id: item.id,
      kind: FEED_KIND[e.type] ?? "transfer_internal",
      title: item.title,
      subtitle: item.subtitle,
      amount: item.amount ?? 0n,
      timestamp: item.timestamp,
      txHash: item.txHash,
    };
  });
}

interface BlockTimestampCache {
  [blockNumber: string]: number;
}

interface HistoryClient {
  publicClient: unknown;
}

interface HistoryPublicClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<Record<string, unknown>>;
  getLogs(args: {
    address: Address;
    event: typeof TRANSFER_EVENT;
    args?: { to?: Address };
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<TransferLog[]>;
  getContractEvents(args: {
    address: Address;
    abi: unknown;
    eventName: string;
    args?: Record<string, Address>;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<ContractEventLog[]>;
  readContract(args: {
    address: Address;
    abi: unknown;
    functionName: string;
    args: [bigint];
  }): Promise<{
    requestor: Address;
    payer: Address;
    amount: bigint;
    expiry: bigint;
    status: number;
  }>;
}

interface ContractEventLog {
  args: Record<string, unknown>;
  blockNumber: bigint | null;
  transactionHash: Hash | null;
  logIndex: number | null;
}

interface TransferLog {
  args: { from?: Address; to?: Address; value?: bigint };
  blockNumber: bigint | null;
  transactionHash: Hash | null;
  logIndex?: number | null;
}

interface RequestCreatedLog extends ContractEventLog {
  args: {
    requestId?: bigint;
    requestor?: Address;
    payer?: Address;
    amount?: bigint;
    memo?: string;
  };
}

interface RequestPaidLog extends ContractEventLog {
  args: {
    requestId?: bigint;
    payer?: Address;
    amount?: bigint;
  };
}

interface RequestCancelledLog extends ContractEventLog {
  args: {
    requestId?: bigint;
  };
}

interface BatchPaidLog extends ContractEventLog {
  args: {
    sender?: Address;
    recipients?: Address[];
    amounts?: bigint[];
    batchId?: string;
  };
}

/**
 * Recover the creation time (ms) embedded in a history id by makeHistoryId
 * (`${prefix}_${Date.now()}_${rand}`). The id is fixed at creation, so it is a
 * more reliable source than a stored `createdAt`, which can be lost or clobbered
 * by a later re-persist — that made every link in History → Links show the same
 * date. Returns null when the id has no parseable timestamp.
 */
export function timestampFromHistoryId(id: string): number | null {
  const ms = Number(id.split("_")[1]);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function makeHistoryId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function saveCreatedLinks(
  links: Array<{
    id: string;
    label: string;
    uri: string;
    shareUrl: string;
    to: string;
    targetAddress: string | null;
    amount: bigint | null;
    expiry: string | null;
    maxUses: number | null;
  }>,
): void {
  const existing = loadStoredLinks();
  const next: StoredLinkHistory[] = [
    ...links.map((link) => ({
      id: link.id,
      label: link.label,
      uri: link.uri,
      shareUrl: link.shareUrl,
      to: link.to,
      targetAddress: link.targetAddress,
      amount: link.amount?.toString() ?? null,
      expiry: link.expiry,
      maxUses: link.maxUses,
      createdAt: Date.now(),
      status: "unpaid" as const,
      txHash: null,
      paidAt: null,
    })),
    ...existing,
  ];
  localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(next.slice(0, 200)));
}

export async function getLinkHistory(
  client: HistoryClient,
  address: Address | null,
): Promise<LinkHistoryItem[]> {
  const publicClient = getHistoryPublicClient(client);
  const links = loadStoredLinks().map(deserializeLink);
  if (address === null || links.length === 0) return links.sort(sortByNewest);

  const eligible = links.filter((link) =>
    link.status === "unpaid" &&
    link.amount !== null &&
    link.targetAddress?.toLowerCase() === address.toLowerCase(),
  );

  if (eligible.length === 0) return links.sort(sortByNewest);

  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > HISTORY_BLOCK_WINDOW ? latestBlock - HISTORY_BLOCK_WINDOW : 0n;
  const transfers = await getPagedTransferLogs(publicClient, {
    address: APP_CONFIG.contracts.qusdc,
    event: TRANSFER_EVENT,
    args: { to: address },
    fromBlock,
    toBlock: latestBlock,
  });
  const timestamps = await getBlockTimestamps(
    client,
    transfers.map((log) => log.blockNumber).filter(isNonNullBigInt),
  );

  const unmatchedTransfers = transfers
    .map((log) => ({
      amount: log.args.value,
      txHash: log.transactionHash ?? null,
      timestamp: timestamps[log.blockNumber?.toString() ?? "0"] ?? 0,
    }))
    .filter((item) => item.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  const updated = links.map((link) => ({ ...link }));
  for (const link of updated) {
    if (
      link.status !== "unpaid" ||
      link.amount === null ||
      link.targetAddress?.toLowerCase() !== address.toLowerCase()
    ) {
      continue;
    }

    const matchIndex = unmatchedTransfers.findIndex((transfer) =>
      transfer.amount === link.amount &&
      transfer.timestamp * 1000 >= link.createdAt,
    );
    if (matchIndex === -1) continue;

    const match = unmatchedTransfers.splice(matchIndex, 1)[0];
    if (match === undefined) continue;
    link.status = "paid";
    link.txHash = match.txHash;
    link.paidAt = match.timestamp * 1000;
  }

  persistLinks(updated);
  return updated.sort(sortByNewest);
}

export async function getRequestHistory(
  client: HistoryClient,
  address: Address | null,
): Promise<RequestHistoryItem[]> {
  const publicClient = getHistoryPublicClient(client);
  if (address === null) return [];

  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > HISTORY_BLOCK_WINDOW ? latestBlock - HISTORY_BLOCK_WINDOW : 0n;

  const [createdByRequestorRaw, createdByPayerRaw] = await Promise.all([
    getPagedContractEvents(publicClient, {
      address: APP_CONFIG.contracts.paymentRequest,
      abi: PAYMENT_REQUEST_ABI,
      eventName: "RequestCreated",
      args: { requestor: address },
      fromBlock,
      toBlock: latestBlock,
    }),
    getPagedContractEvents(publicClient, {
      address: APP_CONFIG.contracts.paymentRequest,
      abi: PAYMENT_REQUEST_ABI,
      eventName: "RequestCreated",
      args: { payer: address },
      fromBlock,
      toBlock: latestBlock,
    }),
  ]);
  const createdByRequestor = createdByRequestorRaw as RequestCreatedLog[];
  const createdByPayer = createdByPayerRaw as RequestCreatedLog[];

  const createdLogs = dedupeByKey(
    [...createdByRequestor, ...createdByPayer],
    (log) => log.args.requestId?.toString() ?? `${log.transactionHash}`,
  );

  if (createdLogs.length === 0) return [];

  const [paidLogsRaw, cancelledLogsRaw] = await Promise.all([
    getPagedContractEvents(publicClient, {
      address: APP_CONFIG.contracts.paymentRequest,
      abi: PAYMENT_REQUEST_ABI,
      eventName: "RequestPaid",
      fromBlock,
      toBlock: latestBlock,
    }),
    getPagedContractEvents(publicClient, {
      address: APP_CONFIG.contracts.paymentRequest,
      abi: PAYMENT_REQUEST_ABI,
      eventName: "RequestCancelled",
      fromBlock,
      toBlock: latestBlock,
    }),
  ]);
  const paidLogs = paidLogsRaw as RequestPaidLog[];
  const cancelledLogs = cancelledLogsRaw as RequestCancelledLog[];

  const paidById = new Map(
    paidLogs.map((log) => [log.args.requestId?.toString() ?? "", log]),
  );
  const cancelledById = new Map(
    cancelledLogs.map((log) => [log.args.requestId?.toString() ?? "", log]),
  );
  const timestamps = await getBlockTimestamps(
    client,
    createdLogs.map((log) => log.blockNumber).filter(isNonNullBigInt),
  );

  const records = await Promise.all(
    createdLogs.map(async (log) => {
      const requestId = log.args.requestId;
      if (requestId === undefined) return null;
      const request = await publicClient.readContract({
        address: APP_CONFIG.contracts.paymentRequest,
        abi: PAYMENT_REQUEST_ABI,
        functionName: "getRequest",
        args: [requestId],
      });

      const idKey = requestId.toString();
      const paid = paidById.get(idKey);
      const cancelled = cancelledById.get(idKey);
      const createdAt = timestamps[log.blockNumber?.toString() ?? "0"] ?? 0;
      const memo = decodeMemo(log.args.memo ?? "0x");
      const status =
        cancelled !== undefined ? "cancelled" :
          paid !== undefined ? "paid" :
            request.status === 2 ? "cancelled" :
              request.status === 1 ? "paid" : "unpaid";

      return {
        requestId,
        requestor: request.requestor,
        payer: request.payer,
        amount: request.amount,
        memo,
        expiry: BigInt(request.expiry),
        status,
        createdAt: createdAt * 1000,
        createdTxHash: log.transactionHash ?? null,
        settledTxHash: paid?.transactionHash ?? cancelled?.transactionHash ?? null,
      } satisfies RequestHistoryItem;
    }),
  );

  return records.filter(isNotNull).sort(sortByNewest);
}

export async function getBatchHistory(
  client: HistoryClient,
  address: Address | null,
): Promise<BatchHistoryItem[]> {
  const publicClient = getHistoryPublicClient(client);
  if (address === null) return [];

  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > HISTORY_BLOCK_WINDOW ? latestBlock - HISTORY_BLOCK_WINDOW : 0n;
  const logsRaw = await getPagedContractEvents(publicClient, {
    address: APP_CONFIG.contracts.batchPayments,
    abi: BATCH_PAYMENTS_ABI,
    eventName: "BatchPaid",
    args: { sender: address },
    fromBlock,
    toBlock: latestBlock,
  });
  const logs = logsRaw as BatchPaidLog[];

  const timestamps = await getBlockTimestamps(
    client,
    logs.map((log) => log.blockNumber).filter(isNonNullBigInt),
  );

  return logs
    .map((log) => {
      const recipients = (log.args.recipients ?? []) as Address[];
      const amounts = (log.args.amounts ?? []) as bigint[];
      return {
        batchId: log.args.batchId ?? "",
        sender: log.args.sender as Address,
        recipients,
        amounts,
        totalAmount: amounts.reduce((sum, amount) => sum + amount, 0n),
        createdAt: (timestamps[log.blockNumber?.toString() ?? "0"] ?? 0) * 1000,
        txHash: log.transactionHash ?? null,
      } satisfies BatchHistoryItem;
    })
    .sort(sortByNewest);
}

export async function getGlobalFeed(client: HistoryClient): Promise<FeedItem[]> {
  const publicClient = getHistoryPublicClient(client);
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > FEED_BLOCK_WINDOW ? latestBlock - FEED_BLOCK_WINDOW : 0n;

  const [requestCreatedRaw, requestPaidRaw, batchPaidRaw] = await Promise.all([
    getPagedContractEvents(publicClient, {
      address: APP_CONFIG.contracts.paymentRequest,
      abi: PAYMENT_REQUEST_ABI,
      eventName: "RequestCreated",
      fromBlock,
      toBlock: latestBlock,
    }),
    getPagedContractEvents(publicClient, {
      address: APP_CONFIG.contracts.paymentRequest,
      abi: PAYMENT_REQUEST_ABI,
      eventName: "RequestPaid",
      fromBlock,
      toBlock: latestBlock,
    }),
    getPagedContractEvents(publicClient, {
      address: APP_CONFIG.contracts.batchPayments,
      abi: BATCH_PAYMENTS_ABI,
      eventName: "BatchPaid",
      fromBlock,
      toBlock: latestBlock,
    }),
  ]);
  const requestCreated = requestCreatedRaw as RequestCreatedLog[];
  const requestPaid = requestPaidRaw as RequestPaidLog[];
  const batchPaid = batchPaidRaw as BatchPaidLog[];

  const timestamps = await getBlockTimestamps(
    client,
    [
      ...requestCreated.map((log) => log.blockNumber),
      ...requestPaid.map((log) => log.blockNumber),
      ...batchPaid.map((log) => log.blockNumber),
    ].filter(isNonNullBigInt),
  );

  const items: FeedItem[] = [
    ...requestCreated.map((log) => ({
      id: `rc_${log.transactionHash}_${log.logIndex}`,
      kind: "request_created" as const,
      title: "Payment request created",
      subtitle: `${shortAddress(log.args.requestor as string)} requested from ${shortAddress(log.args.payer as string)}`,
      amount: log.args.amount ?? 0n,
      timestamp: (timestamps[log.blockNumber?.toString() ?? "0"] ?? 0) * 1000,
      txHash: log.transactionHash ?? null,
    })),
    ...requestPaid.map((log) => ({
      id: `rp_${log.transactionHash}_${log.logIndex}`,
      kind: "request_paid" as const,
      title: "Payment request paid",
      subtitle: `${shortAddress(log.args.payer as string)} settled request #${log.args.requestId?.toString() ?? "?"}`,
      amount: log.args.amount ?? 0n,
      timestamp: (timestamps[log.blockNumber?.toString() ?? "0"] ?? 0) * 1000,
      txHash: log.transactionHash ?? null,
    })),
    ...batchPaid.map((log) => {
      const amounts = (log.args.amounts ?? []) as bigint[];
      const total = amounts.reduce((sum, amount) => sum + amount, 0n);
      const recipients = (log.args.recipients ?? []) as Address[];
      return {
        id: `bp_${log.transactionHash}_${log.logIndex}`,
        kind: "batch_paid" as const,
        title: "Batch payout sent",
        subtitle: `${shortAddress(log.args.sender as string)} paid ${recipients.length} recipients`,
        amount: total,
        timestamp: (timestamps[log.blockNumber?.toString() ?? "0"] ?? 0) * 1000,
        txHash: log.transactionHash ?? null,
      };
    }),
  ];

  return items
    .filter((item) => item.timestamp > 0)
    .sort(sortByNewest)
    .slice(0, 12);
}

export async function getWalletFeed(
  client: HistoryClient,
  smartAccount: Address | null,
  ownerAddress: Address | null,
): Promise<FeedItem[]> {
  const tracked = [smartAccount, ownerAddress].filter((value): value is Address => value !== null);
  if (tracked.length === 0) return [];

  const publicClient = getHistoryPublicClient(client);
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > FEED_BLOCK_WINDOW ? latestBlock - FEED_BLOCK_WINDOW : 0n;
  const trackedSet = new Set(tracked.map((value) => value.toLowerCase()));

  const transferGroups = await Promise.all(
    tracked.flatMap((value) => ([
      getPagedTransferLogs(publicClient, {
        address: APP_CONFIG.contracts.qusdc,
        event: TRANSFER_EVENT,
        args: { to: value },
        fromBlock,
        toBlock: latestBlock,
      }),
      getPagedTransferLogs(publicClient, {
        address: APP_CONFIG.contracts.qusdc,
        event: TRANSFER_EVENT,
        args: { from: value },
        fromBlock,
        toBlock: latestBlock,
      }),
    ])),
  );

  const transferLogs = dedupeByKey(
    transferGroups.flat(),
    (log) => `${log.transactionHash ?? "0x"}_${log.logIndex ?? -1}_${log.blockNumber?.toString() ?? "0"}`,
  );

  const [batchGroups, requestCreatedGroups, requestPaidGroups] = await Promise.all([
    Promise.all(
      tracked.map((value) => getPagedContractEvents(publicClient, {
        address: APP_CONFIG.contracts.batchPayments,
        abi: BATCH_PAYMENTS_ABI,
        eventName: "BatchPaid",
        args: { sender: value },
        fromBlock,
        toBlock: latestBlock,
      })),
    ),
    Promise.all(
      tracked.flatMap((value) => ([
        getPagedContractEvents(publicClient, {
          address: APP_CONFIG.contracts.paymentRequest,
          abi: PAYMENT_REQUEST_ABI,
          eventName: "RequestCreated",
          args: { requestor: value },
          fromBlock,
          toBlock: latestBlock,
        }),
        getPagedContractEvents(publicClient, {
          address: APP_CONFIG.contracts.paymentRequest,
          abi: PAYMENT_REQUEST_ABI,
          eventName: "RequestCreated",
          args: { payer: value },
          fromBlock,
          toBlock: latestBlock,
        }),
      ])),
    ),
    Promise.all(
      tracked.map((value) => getPagedContractEvents(publicClient, {
        address: APP_CONFIG.contracts.paymentRequest,
        abi: PAYMENT_REQUEST_ABI,
        eventName: "RequestPaid",
        args: { payer: value },
        fromBlock,
        toBlock: latestBlock,
      })),
    ),
  ]);

  const batchPaid = dedupeByKey(
    batchGroups.flat() as BatchPaidLog[],
    (log) => `${log.transactionHash ?? "0x"}_${log.logIndex ?? -1}`,
  );
  const requestCreated = dedupeByKey(
    requestCreatedGroups.flat() as RequestCreatedLog[],
    (log) => `${log.transactionHash ?? "0x"}_${log.logIndex ?? -1}`,
  );
  const requestPaid = dedupeByKey(
    requestPaidGroups.flat() as RequestPaidLog[],
    (log) => `${log.transactionHash ?? "0x"}_${log.logIndex ?? -1}`,
  );

  const timestamps = await getBlockTimestamps(
    client,
    [
      ...transferLogs.map((log) => log.blockNumber),
      ...batchPaid.map((log) => log.blockNumber),
      ...requestCreated.map((log) => log.blockNumber),
      ...requestPaid.map((log) => log.blockNumber),
    ].filter(isNonNullBigInt),
  );

  const transferItems: FeedItem[] = transferLogs.map((log) => {
    const from = log.args.from;
    const to = log.args.to;
    const fromTracked = from !== undefined && trackedSet.has(from.toLowerCase());
    const toTracked = to !== undefined && trackedSet.has(to.toLowerCase());
    const kind =
      fromTracked && toTracked ? "transfer_internal" :
        toTracked ? "transfer_received" :
          "transfer_sent";
    const title =
      kind === "transfer_internal" ? "Moved between your accounts" :
        kind === "transfer_received" ? "QUSDC received" :
          "QUSDC sent";
    const subtitle =
      from === undefined || to === undefined
        ? "QUSDC transfer"
        : `${shortAddress(from)} → ${shortAddress(to)}`;
    return {
      id: `tr_${log.transactionHash}_${log.logIndex ?? 0}`,
      kind,
      title,
      subtitle,
      amount: log.args.value ?? 0n,
      timestamp: (timestamps[log.blockNumber?.toString() ?? "0"] ?? 0) * 1000,
      txHash: log.transactionHash ?? null,
    };
  });

  const items: FeedItem[] = [
    ...transferItems,
    ...requestCreated.map((log) => ({
      id: `rc_${log.transactionHash}_${log.logIndex}`,
      kind: "request_created" as const,
      title: "Payment request created",
      subtitle: `${shortAddress(log.args.requestor as string)} requested from ${shortAddress(log.args.payer as string)}`,
      amount: log.args.amount ?? 0n,
      timestamp: (timestamps[log.blockNumber?.toString() ?? "0"] ?? 0) * 1000,
      txHash: log.transactionHash ?? null,
    })),
    ...requestPaid.map((log) => ({
      id: `rp_${log.transactionHash}_${log.logIndex}`,
      kind: "request_paid" as const,
      title: "Payment request paid",
      subtitle: `${shortAddress(log.args.payer as string)} settled request #${log.args.requestId?.toString() ?? "?"}`,
      amount: log.args.amount ?? 0n,
      timestamp: (timestamps[log.blockNumber?.toString() ?? "0"] ?? 0) * 1000,
      txHash: log.transactionHash ?? null,
    })),
    ...batchPaid.map((log) => {
      const amounts = (log.args.amounts ?? []) as bigint[];
      const total = amounts.reduce((sum, amount) => sum + amount, 0n);
      const recipients = (log.args.recipients ?? []) as Address[];
      return {
        id: `bp_${log.transactionHash}_${log.logIndex}`,
        kind: "batch_paid" as const,
        title: "Batch payout sent",
        subtitle: `${shortAddress(log.args.sender as string)} paid ${recipients.length} recipients`,
        amount: total,
        timestamp: (timestamps[log.blockNumber?.toString() ?? "0"] ?? 0) * 1000,
        txHash: log.transactionHash ?? null,
      };
    }),
  ];

  return items
    .filter((item) => item.timestamp > 0)
    .sort(sortByNewest)
    .slice(0, 12);
}

export function formatQusdc(value: bigint | null): string {
  if (value === null) return "Open";
  return `$${(Number(value) / 1e6).toFixed(2)}`;
}

export function shortAddress(value: string): string {
  if (!value || value === "0x0000000000000000000000000000000000000000") return "Anyone";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function decodeMemo(value: string): string {
  try {
    return hexToString(value as `0x${string}`, { size: 32 }).replace(/\0+$/g, "").trim();
  } catch {
    return "";
  }
}

async function getBlockTimestamps(
  client: HistoryClient,
  blockNumbers: bigint[],
): Promise<BlockTimestampCache> {
  const publicClient = getHistoryPublicClient(client);
  const unique = Array.from(new Set(blockNumbers.map((block) => block.toString())));
  const entries = await Promise.all(
    unique.map(async (blockNumber) => {
      const block = await publicClient.getBlock({ blockNumber: BigInt(blockNumber) });
      return [blockNumber, Number((block as { timestamp?: bigint }).timestamp ?? 0n)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function loadStoredLinks(): StoredLinkHistory[] {
  try {
    const raw = localStorage.getItem(LINKS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as StoredLinkHistory[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Canonical share URL for a stored link. Payment links must always point at the
 * public app domain (APP_CONFIG.appBaseUrl), never the internal host the link
 * happened to be created on (e.g. qevie.duckdns.org). The stored `uri` is
 * host-agnostic, so we rebuild from it; for older records that lost their `uri`
 * we rewrite the origin of the saved URL to the canonical base.
 */
function canonicalShareUrl(uri: string, fallback: string): string {
  const base = APP_CONFIG.appBaseUrl.replace(/\/+$/, "");
  if (uri !== "") return `${base}/pay?pay=${encodeURIComponent(uri)}`;
  try {
    const u = new URL(fallback);
    const canonical = new URL(base);
    u.protocol = canonical.protocol;
    u.host = canonical.host;
    return u.toString();
  } catch {
    return fallback;
  }
}

function persistLinks(links: LinkHistoryItem[]): void {
  const serialized: StoredLinkHistory[] = links.map((link) => ({
    id: link.id,
    label: link.label,
    uri: link.uri,
    shareUrl: link.shareUrl,
    to: link.to,
    targetAddress: link.targetAddress,
    amount: link.amount?.toString() ?? null,
    expiry: link.expiry,
    maxUses: link.maxUses,
    createdAt: link.createdAt,
    status: link.status,
    txHash: link.txHash,
    paidAt: link.paidAt,
  }));
  localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(serialized));
}

function deserializeLink(link: StoredLinkHistory): LinkHistoryItem {
  return {
    id: link.id,
    label: link.label,
    uri: link.uri,
    shareUrl: canonicalShareUrl(link.uri, link.shareUrl),
    // Prefer the immutable timestamp baked into the id over the stored
    // createdAt, which earlier re-persists could collapse to a single value.
    createdAt: timestampFromHistoryId(link.id)
      ?? (Number.isFinite(link.createdAt) && link.createdAt > 0 ? link.createdAt : 0),
    to: link.to,
    targetAddress: link.targetAddress,
    amount: link.amount !== null ? BigInt(link.amount) : null,
    expiry: link.expiry,
    maxUses: link.maxUses,
    status: link.status,
    txHash: link.txHash,
    paidAt: link.paidAt,
  };
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortByNewest<T extends { createdAt?: number; timestamp?: number }>(a: T, b: T): number {
  const aTime = a.createdAt ?? a.timestamp ?? 0;
  const bTime = b.createdAt ?? b.timestamp ?? 0;
  return bTime - aTime;
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

function isNonNullBigInt(value: bigint | null | undefined): value is bigint {
  return value !== null && value !== undefined;
}

function getHistoryPublicClient(client: HistoryClient): HistoryPublicClient {
  return client.publicClient as HistoryPublicClient;
}

async function getPagedTransferLogs(
  publicClient: HistoryPublicClient,
  args: {
    address: Address;
    event: typeof TRANSFER_EVENT;
    args?: { from?: Address; to?: Address };
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<TransferLog[]> {
  const chunks = await Promise.all(
    blockRanges(args.fromBlock, args.toBlock).map((range) =>
      withLogQuerySlot(() => publicClient.getLogs({
        address: args.address,
        event: args.event,
        args: args.args,
        fromBlock: range.from,
        toBlock: range.to,
      })),
    ),
  );
  return chunks.flat();
}

async function getPagedContractEvents(
  publicClient: HistoryPublicClient,
  args: {
    address: Address;
    abi: unknown;
    eventName: string;
    args?: Record<string, Address>;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<ContractEventLog[]> {
  const chunks = await Promise.all(
    blockRanges(args.fromBlock, args.toBlock).map((range) =>
      withLogQuerySlot(() => publicClient.getContractEvents({
        address: args.address,
        abi: args.abi,
        eventName: args.eventName,
        args: args.args,
        fromBlock: range.from,
        toBlock: range.to,
      })),
    ),
  );
  return chunks.flat();
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
