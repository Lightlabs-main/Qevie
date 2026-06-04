import {
  useState,
  useCallback,
  useEffect,
  useContext,
  createContext,
  type ReactNode,
} from "react";
import React from "react";
import type { Address, Hex } from "viem";
import { useQevieClient } from "@qevie/sdk/react";
import type { QevieSigner } from "@qevie/sdk";

interface WalletState {
  address: Address | null;
  signerAddress: Address | null;
  isConnecting: boolean;
  error: string | null;
  signer: QevieSigner | null;
  connect(): Promise<void>;
  disconnect(): void;
}

const WalletContext = createContext<WalletState | null>(null);

function buildEip1193Signer(provider: unknown): QevieSigner {
  const p = provider as {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  };

  return {
    async getAddress(): Promise<Address> {
      const accounts = (await p.request({ method: "eth_requestAccounts" })) as Address[];
      const first = accounts[0];
      if (first === undefined) throw new Error("No accounts available");
      return first;
    },
    async signMessage(message: Uint8Array | string): Promise<Hex> {
      const addr = await this.getAddress();
      const data =
        typeof message === "string"
          ? message
          : `0x${Buffer.from(message).toString("hex")}`;
      return (await p.request({ method: "personal_sign", params: [data, addr] })) as Hex;
    },
  };
}

const LOCAL_STORAGE_KEY = "qevie_signer_address";

export function WalletProvider({ children }: { children: ReactNode }): React.ReactElement {
  const client = useQevieClient();

  const [signer, setSigner] = useState<QevieSigner | null>(null);
  const [signerAddress, setSignerAddress] = useState<Address | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    const win = window as typeof window & { ethereum?: unknown };
    if (win.ethereum === undefined) {
      setError("No Web3 wallet detected. Please install QIE Wallet or MetaMask.");
      setIsConnecting(false);
      return;
    }

    try {
      const s = buildEip1193Signer(win.ethereum);
      const signerAddr = await s.getAddress();
      const smartAddr = await client.getSmartAccountAddress(s);

      setSigner(s);
      setSignerAddress(signerAddr);
      setAddress(smartAddr);
      localStorage.setItem(LOCAL_STORAGE_KEY, signerAddr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setIsConnecting(false);
    }
  }, [client]);

  const disconnect = useCallback(() => {
    setSigner(null);
    setSignerAddress(null);
    setAddress(null);
    setError(null);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }, []);

  // Auto-reconnect on mount if previously connected.
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved !== null) {
      const win = window as typeof window & { ethereum?: unknown };
      if (win.ethereum !== undefined) {
        connect().catch(() => {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return React.createElement(
    WalletContext.Provider,
    { value: { address, signerAddress, signer, isConnecting, error, connect, disconnect } },
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
