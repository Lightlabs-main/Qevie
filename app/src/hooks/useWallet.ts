import {
  useState,
  useCallback,
  useEffect,
  useContext,
  createContext,
  type ReactNode,
} from "react";
import React from "react";
import { bytesToHex, type Address, type Hex } from "viem";
import { useQevieClient } from "@qevie/sdk/react";
import type { QevieSigner } from "@qevie/sdk";

interface WalletState {
  address: Address | null;
  signerAddress: Address | null;
  isConnecting: boolean;
  error: string | null;
  signer: QevieSigner | null;
  /** True when no injected wallet was found on a mobile browser — show the deep-link CTA. */
  needsWalletApp: boolean;
  /** Deep link that re-opens this page inside MetaMask's in-app browser. */
  walletDeepLink: string;
  connect(): Promise<void>;
  disconnect(): void;
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

const WalletContext = createContext<WalletState | null>(null);
const LOCAL_STORAGE_KEY = "qevie_signer_address";

function isMobile(): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

/** MetaMask deep link: opens this exact page inside the wallet's in-app browser. */
function metamaskDeepLink(): string {
  return `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`;
}

function openWalletDeepLink(): void {
  window.location.assign(metamaskDeepLink());
}

/**
 * Resolve an injected EIP-1193 provider. Mobile wallet in-app browsers often
 * inject `window.ethereum` *after* the app mounts, so we can't rely on a
 * synchronous check — we listen for EIP-6963 announcements and the legacy
 * `ethereum#initialized` event, and poll as a fallback, up to `timeoutMs`.
 */
function resolveProvider(timeoutMs = 3000): Promise<Eip1193Provider | null> {
  const injected = (): Eip1193Provider | undefined =>
    (window as typeof window & { ethereum?: Eip1193Provider }).ethereum;

  const now = injected();
  if (now !== undefined) return Promise.resolve(now);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (p: Eip1193Provider | null): void => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
      window.removeEventListener("ethereum#initialized", onInit);
      resolve(p);
    };

    const onAnnounce = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { provider?: Eip1193Provider } | undefined;
      if (detail?.provider !== undefined) finish(detail.provider);
    };
    const onInit = (): void => {
      const p = injected();
      if (p !== undefined) finish(p);
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.addEventListener("ethereum#initialized", onInit, { once: true });
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const start = Date.now();
    const poll = setInterval(() => {
      const p = injected();
      if (p !== undefined) finish(p);
      else if (Date.now() - start > timeoutMs) finish(null);
    }, 200);
  });
}

/**
 * Build a signer over an EIP-1193 provider. The resolved account is cached so
 * repeated `getAddress()` calls (from the SDK + every signature) never re-trigger
 * `eth_requestAccounts` — a second concurrent request makes mobile wallets throw
 * `-32002 Already processing`.
 */
function buildEip1193Signer(provider: Eip1193Provider, knownAddress?: Address): QevieSigner {
  let cached: Address | undefined = knownAddress;
  return {
    async getAddress(): Promise<Address> {
      if (cached !== undefined) return cached;
      // Prefer the silent call; only prompt if nothing is authorized yet.
      const existing = (await provider.request({ method: "eth_accounts" })) as Address[];
      const known = existing[0];
      if (known !== undefined) {
        cached = known;
        return cached;
      }
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
      const first = accounts[0];
      if (first === undefined) throw new Error("No accounts available");
      cached = first;
      return cached;
    },
    async signMessage(message: Uint8Array | string): Promise<Hex> {
      const addr = await this.getAddress();
      const data = typeof message === "string" ? message : bytesToHex(message);
      return (await provider.request({ method: "personal_sign", params: [data, addr] })) as Hex;
    },
  };
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: number }).code;
  if (code === 4001 || /user rejected|denied/i.test(msg)) return "Connection request was rejected.";
  if (code === -32002 || /already processing|already pending/i.test(msg)) {
    return "A wallet request is already open — check your wallet, then try again.";
  }
  return msg || "Failed to connect wallet";
}

export function WalletProvider({ children }: { children: ReactNode }): React.ReactElement {
  const client = useQevieClient();

  const [signer, setSigner] = useState<QevieSigner | null>(null);
  const [signerAddress, setSignerAddress] = useState<Address | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsWalletApp, setNeedsWalletApp] = useState(false);

  const disconnect = useCallback(() => {
    setSigner(null);
    setSignerAddress(null);
    setAddress(null);
    setError(null);
    setNeedsWalletApp(false);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    setNeedsWalletApp(false);

    try {
      const provider = await resolveProvider();
      if (provider === null) {
        // Plain mobile browser with no injected wallet: guide the user into a
        // wallet's in-app browser instead of dead-ending on "no wallet".
        if (isMobile()) {
          setNeedsWalletApp(true);
          setError("No wallet found in this browser. Opening MetaMask...");
          openWalletDeepLink();
        } else {
          setError("No Web3 wallet detected. Please install QIE Wallet or MetaMask.");
        }
        return;
      }

      // Request accounts exactly once, then hand the address to the signer so the
      // SDK's subsequent getAddress() calls reuse it (no second prompt / -32002).
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
      const signerAddr = accounts[0];
      if (signerAddr === undefined) throw new Error("No accounts available");

      const s = buildEip1193Signer(provider, signerAddr);
      const smartAddr = await client.getSmartAccountAddress(s);

      setSigner(s);
      setSignerAddress(signerAddr);
      setAddress(smartAddr);
      localStorage.setItem(LOCAL_STORAGE_KEY, signerAddr);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setIsConnecting(false);
    }
  }, [client]);

  // Silent reconnect on mount — uses eth_accounts (no popup) so a returning user
  // is restored without a prompt, and waits out the mobile injection race.
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved === null) return;

    let cancelled = false;
    void (async () => {
      const provider = await resolveProvider(1500);
      if (provider === null || cancelled) return;
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
        const acct = accounts[0];
        if (acct === undefined) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          return;
        }
        const s = buildEip1193Signer(provider, acct);
        const smartAddr = await client.getSmartAccountAddress(s);
        if (cancelled) return;
        setSigner(s);
        setSignerAddress(acct);
        setAddress(smartAddr);
        localStorage.setItem(LOCAL_STORAGE_KEY, acct);

        // React to the user switching accounts or disconnecting in the wallet.
        provider.on?.("accountsChanged", (...args: unknown[]) => {
          const next = (args[0] as Address[] | undefined)?.[0];
          if (next === undefined) disconnect();
          else void connect();
        });
      } catch {
        /* leave disconnected */
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return React.createElement(
    WalletContext.Provider,
    {
      value: {
        address,
        signerAddress,
        signer,
        isConnecting,
        error,
        needsWalletApp,
        walletDeepLink: typeof window === "undefined" ? "" : metamaskDeepLink(),
        connect,
        disconnect,
      },
    },
    children,
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (ctx === null) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return ctx;
}
