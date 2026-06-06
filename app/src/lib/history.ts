import {
  BATCH_PAYMENTS_ABI,
  PAYMENT_REQUEST_ABI,
} from "@qevie/sdk";
import {
  type Address,
  type Hash,
  hexToString,
  parseAbiItem,
} from "viem";
import { APP_CONFIG } from "../config.js";

const LINKS_STORAGE_KEY = "qevie_history_links_v1";
const HISTORY_BLOCK_WINDOW = 60_000n;
const FEED_BLOCK_WINDOW = 20_000n;
const MAX_LOG_BLOCK_SPAN = 9_000n;

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
  kind: "request_created" | "request_paid" | "batch_paid";
  title: string;
  subtitle: string;
  amount: bigint;
  timestamp: number;
  txHash: Hash | null;
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
  args: { value?: bigint };
  blockNumber: bigint | null;
  transactionHash: Hash | null;
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

function persistLinks(links: LinkHistoryItem[]): void {
  const serialized: StoredLinkHistory[] = links.map((link) => ({
    id: link.id,
    label: link.label,
    uri: "",
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
    shareUrl: link.shareUrl,
    to: link.to,
    targetAddress: link.targetAddress,
    amount: link.amount !== null ? BigInt(link.amount) : null,
    createdAt: link.createdAt,
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
    args?: { to?: Address };
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<TransferLog[]> {
  const logs: TransferLog[] = [];
  for (let start = args.fromBlock; start <= args.toBlock; start += MAX_LOG_BLOCK_SPAN + 1n) {
    const end = minBigInt(start + MAX_LOG_BLOCK_SPAN, args.toBlock);
    const chunk = await publicClient.getLogs({
      address: args.address,
      event: args.event,
      args: args.args,
      fromBlock: start,
      toBlock: end,
    });
    logs.push(...chunk);
  }
  return logs;
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
  const logs: ContractEventLog[] = [];
  for (let start = args.fromBlock; start <= args.toBlock; start += MAX_LOG_BLOCK_SPAN + 1n) {
    const end = minBigInt(start + MAX_LOG_BLOCK_SPAN, args.toBlock);
    const chunk = await publicClient.getContractEvents({
      address: args.address,
      abi: args.abi,
      eventName: args.eventName,
      args: args.args,
      fromBlock: start,
      toBlock: end,
    });
    logs.push(...chunk);
  }
  return logs;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
