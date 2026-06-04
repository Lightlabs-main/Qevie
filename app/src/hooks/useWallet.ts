import { useState, useCallback, useEffect } from "react";
import type { Address, Hex } from "viem";
import { useQevieClient } from "@qevie/sdk/react";
import type { QevieSigner } from "@qevie/sdk";

interface WalletState {
  address: Address | null;
  signerAddress: Address | null;
  isConnecting: boolean;
  error: string | null;
}

interface WalletActions {
  connect(): Promise<void>;
  disconnect(): void;
  signer: QevieSigner | null;
}

const LOCAL_STORAGE_KEY = "qevie_signer_address";

/** Build a QevieSigner from the browser's injected EIP-1193 provider. */
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
      const sig = (await p.request({
        method: "personal_sign",
        params: [data, addr],
      })) as Hex;
      return sig;
    },
  };
}

export function useWallet(): WalletState & WalletActions {
  const client = useQevieClient();

  const [signerState, setSignerState] = useState<{
    signer: QevieSigner | null;
    signerAddress: Address | null;
  }>({ signer: null, signerAddress: null });

  const [address, setAddress] = useState<Address | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    const win = window as typeof window & { ethereum?: unknown };
    if (win.ethereum === undefined) {
      setError("No Web3 wallet detected. Please install QIE Wallet or MetaMask.");
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const signer = buildEip1193Signer(win.ethereum);
      const signerAddr = await signer.getAddress();
      const smartAddr = await client.getSmartAccountAddress(signer);

      setSignerState({ signer, signerAddress: signerAddr });
      setAddress(smartAddr);
      localStorage.setItem(LOCAL_STORAGE_KEY, signerAddr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setIsConnecting(false);
    }
  }, [client]);

  const disconnect = useCallback(() => {
    setSignerState({ signer: null, signerAddress: null });
    setAddress(null);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }, []);

  // Auto-reconnect if previously connected.
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved !== null) {
      const win = window as typeof window & { ethereum?: unknown };
      if (win.ethereum !== undefined) {
        connect().catch(() => {
          // Auto-reconnect failed silently; user can reconnect manually.
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    address,
    signerAddress: signerState.signerAddress,
    signer: signerState.signer,
    isConnecting,
    error,
    connect,
    disconnect,
  };
}
