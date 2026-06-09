import type { Address } from "viem";

export interface QevieContracts {
  entryPoint: Address;
  accountFactory: Address;
  paymaster: Address;
  batchPayments: Address;
  paymentRequest: Address;
  subscriptionManager: Address;
  usernameRegistry: Address;
  receiptRegistry?: Address;
  agentPolicyManager?: Address;
  qusdc: Address;
  wqie: Address;
  dexPair: Address;
  /**
   * QIE Domains registry (reverse lookups: address -> name.qie, domainExist).
   * Optional — when absent, `.qie` reverse verification is unavailable.
   */
  qieDomainRegistry?: Address;
  /**
   * QIE Domains forward resolver (name.qie -> address). Optional — when absent,
   * `.qie` forward resolution is cleanly unavailable (never faked).
   */
  qieDomainResolver?: Address;
}

/**
 * QIE testnet (1983) contract addresses.
 * All contracts deployed 2026-06-04. See VERIFICATION.md for explorer links.
 * Uses testnet stubs: TestQUSDC (mintable), TestDexPair (configurable reserves).
 */
export const TESTNET_CONTRACTS: QevieContracts = {
  entryPoint: "0xa07d2Ff33400fbE2c741385cb959D5BCbA041493",
  accountFactory: "0xF4cB7EB568cca9714aD3A6adCAFAaBFB39eA6E14",
  paymaster: "0x082022A246b899C216Ba9e0ea339c8E7C8a4D0b4",
  batchPayments: "0xb07fff088D37355EAD2f4226e208DAA32f7b6a19",
  paymentRequest: "0x9ee2d86248F3811E6e63d7C7F025E717AAE877aB",
  subscriptionManager: "0x0705e239bF3F8250DADA4aad1051C33C32fb988a",
  usernameRegistry: "0x82f50077a8cB6988DF4bBB9B8BD9f92F95975bF4",
  agentPolicyManager: "0x5E0FABf9aD44a21A38775942a1041c55fbAAE89A",
  qusdc: "0x850E073f0E7536A03fE22DB0CFBeA08e6DB3e18f",
  wqie: "0xb905700A0DF3eA5990710F88C7EDF0Af6e8884c5",
  dexPair: "0xd94975d051634C4422D84dA9D4D89DC9Fb00DC5F",
} as const;

/**
 * QIE mainnet (1990) contract addresses.
 * Populated after Phase 6 mainnet deploy. See VERIFICATION.md for explorer links.
 */
export const MAINNET_CONTRACTS: QevieContracts = {
  entryPoint: "0xa07d2Ff33400fbE2c741385cb959D5BCbA041493",
  accountFactory: "0x77d6229316E3eFEfD22c2FA267464dB7665446A6",
  paymaster: "0xd41C837e0c91024b41A2F456DF4100d0c964bBb1",
  batchPayments: "0x2118BCED5E0dE9CC3283CB6eFce40e0Bc3Cc3061",
  paymentRequest: "0x850E073f0E7536A03fE22DB0CFBeA08e6DB3e18f",
  subscriptionManager: "0xb905700A0DF3eA5990710F88C7EDF0Af6e8884c5",
  usernameRegistry: "0xd94975d051634C4422D84dA9D4D89DC9Fb00DC5F",
  agentPolicyManager: "0x6ed8b09371e133dab2AC87Da81615D3152092E3A",
  receiptRegistry: "0xda85bC2bfAf6Cb2062f57dCae90D5b2f4c3C4c0f",
  qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  wqie: "0x0087904D95BEe9E5F24dc8852804b547981A9139",
  dexPair: "0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe",
} as const;
