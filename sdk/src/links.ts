import type { ParsedPaymentLink, PaymentLinkParams } from "./types.js";

const SCHEME = "qevie";

/**
 * qevie: URI scheme for payment links and QR codes.
 *
 * Format: qevie:<recipient>[?amount=<6dec>&memo=<str>&expiry=<unix>&id=<linkId>]
 *
 * Examples:
 *   qevie:alice_qie?amount=5000000&memo=lunch
 *   qevie:0xABCD...?amount=1000000
 *   qevie:bob.qie
 */
export function buildPaymentUri(params: PaymentLinkParams): string {
  const base = `${SCHEME}:${encodeURIComponent(params.to)}`;
  const query = new URLSearchParams();

  if (params.amount !== undefined) {
    query.set("amount", params.amount.toString());
  }
  if (params.memo) {
    query.set("memo", params.memo);
  }
  if (params.expirySeconds !== undefined) {
    const expiry = Math.floor(Date.now() / 1000) + params.expirySeconds;
    query.set("expiry", expiry.toString());
  }

  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Parse a qevie: URI or a shareable https URL containing one. */
export function parsePaymentUri(uri: string): ParsedPaymentLink | null {
  let raw = uri.trim();

  // Extract from https link if embedded as a fragment or path.
  if (raw.startsWith("https://") || raw.startsWith("http://")) {
    try {
      const url = new URL(raw);
      const embedded = url.searchParams.get("pay") ?? url.hash.slice(1);
      if (embedded) raw = decodeURIComponent(embedded);
    } catch {
      return null;
    }
  }

  if (!raw.startsWith(`${SCHEME}:`)) return null;

  const withoutScheme = raw.slice(SCHEME.length + 1);
  const [recipientPart, queryPart] = withoutScheme.split("?");
  if (!recipientPart) return null;

  const to = decodeURIComponent(recipientPart);
  const result: ParsedPaymentLink = { to };

  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const amount = params.get("amount");
    if (amount !== null) result.amount = BigInt(amount);
    const memo = params.get("memo");
    if (memo !== null) result.memo = memo;
    const expiry = params.get("expiry");
    if (expiry !== null) result.expiry = Number(expiry);
    const id = params.get("id");
    if (id !== null) result.linkId = id;
  }

  return result;
}

/** Build a shareable https URL wrapping a qevie: URI. */
export function buildShareUrl(appBaseUrl: string, params: PaymentLinkParams): string {
  const uri = buildPaymentUri(params);
  const url = new URL("/pay", appBaseUrl);
  url.searchParams.set("pay", encodeURIComponent(uri));
  return url.toString();
}
