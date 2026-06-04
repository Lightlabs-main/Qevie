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
 * QIE testnet (1983) contract addresses.
 * All contracts deployed 2026-06-04. See VERIFICATION.md for explorer links.
 * Uses testnet stubs: TestQUSDC (mintable), TestDexPair (configurable reserves).
 */
export const TESTNET_CONTRACTS: QevieContracts = {
  entryPoint: "0xa07d2Ff33400fbE2c741385cb959D5BCbA041493",
  accountFactory: "0x9E87eBcde02fc7c3729863D7C371030F8101E7CE",
  paymaster: "0x1cdD6BC4258F590E0ea2b10E82a8162384d7f5f2",
  batchPayments: "0xb07fff088D37355EAD2f4226e208DAA32f7b6a19",
  paymentRequest: "0x9ee2d86248F3811E6e63d7C7F025E717AAE877aB",
  subscriptionManager: "0x0705e239bF3F8250DADA4aad1051C33C32fb988a",
  usernameRegistry: "0x82f50077a8cB6988DF4bBB9B8BD9f92F95975bF4",
  qusdc: "0x850E073f0E7536A03fE22DB0CFBeA08e6DB3e18f",
  wqie: "0xb905700A0DF3eA5990710F88C7EDF0Af6e8884c5",
  dexPair: "0xd94975d051634C4422D84dA9D4D89DC9Fb00DC5F",
} as const;

/**
 * QIE mainnet (1990) contract addresses.
 * Populated after Phase 6 mainnet deploy. See VERIFICATION.md for explorer links.
 */
export const MAINNET_CONTRACTS: Partial<QevieContracts> = {
  qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  wqie: "0x0087904D95BEe9E5F24dc8852804b547981A9139",
  dexPair: "0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe",
} as const;
