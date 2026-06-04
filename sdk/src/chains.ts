import type { Chain } from "viem";

export const qieMainnet = {
  id: 1990,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://rpc1mainnet.qie.digital/",
        "https://rpc2mainnet.qie.digital/",
        "https://rpc5mainnet.qie.digital/",
      ],
    },
  },
  blockExplorers: {
    default: { name: "QIE Explorer", url: "https://mainnet.qie.digital" },
  },
} as const satisfies Chain;

export const qieTestnet = {
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://rpc1testnet.qie.digital/",
        "https://rpc2testnet.qie.digital/",
        "https://rpc3testnet.qie.digital/",
      ],
    },
  },
  blockExplorers: {
    default: { name: "QIE Testnet Explorer", url: "https://testnet.qie.digital" },
  },
  testnet: true,
} as const satisfies Chain;
