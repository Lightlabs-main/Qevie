import type { Address } from "viem";

export interface QevieContracts {
  entryPoint: Address;
  accountFactory: Address;
  paymaster: Address;
  batchPayments: Address;
  paymentRequest: Address;
  subscriptionManager: Address;
  usernameRegistry: Address;
  qusdc: Address;
  wqie: Address;
  dexPair: Address;
}

/**
 * QIE testnet (1983) contract addresses. Updated after each deployment.
 * See VERIFICATION.md for explorer links.
 */
export const TESTNET_CONTRACTS: Partial<QevieContracts> = {
  entryPoint: "0xa07d2Ff33400fbE2c741385cb959D5BCbA041493",
  accountFactory: "0x6ed8b09371e133dab2AC87Da81615D3152092E3A",
  // paymaster, batch, request, subscription, registry: deployed in Phase 2-3
  qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  wqie: "0x0087904D95BEe9E5F24dc8852804b547981A9139",
  dexPair: "0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe",
} as const;

/**
 * QIE mainnet (1990) contract addresses. Populated after Phase 6 mainnet deploy.
 * See VERIFICATION.md for explorer links.
 */
export const MAINNET_CONTRACTS: Partial<QevieContracts> = {
  qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  wqie: "0x0087904D95BEe9E5F24dc8852804b547981A9139",
  dexPair: "0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe",
} as const;
