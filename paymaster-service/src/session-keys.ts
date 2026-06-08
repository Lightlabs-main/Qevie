/**
 * Server-custodied Autopilot session keys.
 *
 * Autopilot needs a key that can sign payments unattended, bounded by the
 * on-chain policy (limits, recipients, expiry, guardian revoke). Non-technical
 * users cannot generate or hold such a key themselves, so the service mints it,
 * stores the private key encrypted at rest, and returns only the public address
 * for the policy. The keeper/executor later loads the private key by address to
 * sign session UserOperations.
 *
 * Storage: a JSON file (SESSION_KEY_STORE_PATH). Each private key is encrypted
 * with AES-256-GCM under a key derived (scrypt) from SESSION_KEY_ENC_SECRET and
 * a per-record random salt. The secret is REQUIRED — without it, provisioning
 * fails closed rather than writing plaintext keys to disk.
 */

import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Address, type Hex, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SESSION_KEY_ENC_SECRET, SESSION_KEY_STORE_PATH } from "./config.js";

interface SessionKeyRecord {
  /** The smart account this key was provisioned for (checksummed). */
  smartAccount: Address;
  /** The session key public address (checksummed). */
  sessionKey: Address;
  /** AES-256-GCM ciphertext of the 0x-prefixed private key, hex. */
  ciphertext: Hex;
  /** scrypt salt, hex. */
  salt: Hex;
  /** AES-GCM IV, hex. */
  iv: Hex;
  /** AES-GCM auth tag, hex. */
  authTag: Hex;
  /** Unix seconds. */
  createdAt: number;
}

function toHex(buf: Buffer): Hex {
  return `0x${buf.toString("hex")}`;
}

function fromHex(hex: Hex): Buffer {
  return Buffer.from(hex.slice(2), "hex");
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

function encryptPrivateKey(privateKey: Hex): Pick<
  SessionKeyRecord,
  "ciphertext" | "salt" | "iv" | "authTag"
> {
  const secret = SESSION_KEY_ENC_SECRET();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(secret, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: toHex(ciphertext),
    salt: toHex(salt),
    iv: toHex(iv),
    authTag: toHex(authTag),
  };
}

function decryptPrivateKey(record: SessionKeyRecord): Hex {
  const secret = SESSION_KEY_ENC_SECRET();
  const key = deriveKey(secret, fromHex(record.salt));
  const decipher = createDecipheriv("aes-256-gcm", key, fromHex(record.iv));
  decipher.setAuthTag(fromHex(record.authTag));
  const plaintext = Buffer.concat([
    decipher.update(fromHex(record.ciphertext)),
    decipher.final(),
  ]);
  return plaintext.toString("utf8") as Hex;
}

function loadStore(): SessionKeyRecord[] {
  const path = SESSION_KEY_STORE_PATH();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionKeyRecord[];
  } catch {
    return [];
  }
}

function saveStore(records: SessionKeyRecord[]): void {
  const path = SESSION_KEY_STORE_PATH();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mode 0o600: private keys (encrypted) — owner read/write only.
  writeFileSync(path, JSON.stringify(records, null, 2), { mode: 0o600 });
}

/**
 * Mint a fresh session keypair for a smart account, persist the encrypted
 * private key, and return the public address to put in the policy. A new key is
 * generated per call so each policy gets a distinct, independently revocable key.
 */
export function provisionSessionKey(smartAccount: Address): Address {
  const account = getAddress(smartAccount);
  const privateKey = generatePrivateKey();
  const sessionKey = privateKeyToAccount(privateKey).address;

  const records = loadStore();
  records.push({
    smartAccount: account,
    sessionKey,
    createdAt: Math.floor(Date.now() / 1000),
    ...encryptPrivateKey(privateKey),
  });
  saveStore(records);

  return sessionKey;
}

/**
 * Load the private key for a previously provisioned session key address.
 * Used by the executor/keeper to sign session UserOperations. Returns null if
 * the address was never provisioned by this service.
 */
export function getSessionPrivateKey(sessionKey: Address): Hex | null {
  const target = getAddress(sessionKey);
  const record = loadStore().find((r) => r.sessionKey === target);
  return record === undefined ? null : decryptPrivateKey(record);
}
