import { useState, useCallback } from "react";
import { useQevieContext } from "./QevieProvider.js";
import type { QevieAccount } from "../account.js";
import type { QevieSigner, GasQuote, GasMode, UserOpResult, PayParams } from "../types.js";

interface UseQevieAccountState {
  account: QevieAccount | null;
  address: `0x${string}` | null;
  isLoading: boolean;
  error: Error | null;
}

interface UseQevieAccountActions {
  connect(signer: QevieSigner, salt?: bigint): Promise<void>;
  pay(params: PayParams): Promise<UserOpResult>;
  quoteGas(mode: GasMode): Promise<GasQuote>;
  disconnect(): void;
}

export function useQevieAccount(): UseQevieAccountState & UseQevieAccountActions {
  const { client } = useQevieContext();

  const [account, setAccount] = useState<QevieAccount | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const connect = useCallback(
    async (signer: QevieSigner, salt?: bigint) => {
      setIsLoading(true);
      setError(null);
      try {
        const acc = client.account(signer, salt);
        const addr = await acc.getAddress();
        setAccount(acc);
        setAddress(addr);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const pay = useCallback(
    async (params: PayParams): Promise<UserOpResult> => {
      if (account === null) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);
      try {
        return await client.pay(account.signer, params);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, account],
  );

  const quoteGas = useCallback(
    async (mode: GasMode): Promise<GasQuote> => {
      if (account === null) throw new Error("Not connected");
      return client.quoteGas(account.signer, mode);
    },
    [client, account],
  );

  const disconnect = useCallback(() => {
    setAccount(null);
    setAddress(null);
    setError(null);
  }, []);

  return { account, address, isLoading, error, connect, pay, quoteGas, disconnect };
}
