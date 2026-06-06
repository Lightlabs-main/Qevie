export const QUSDC_ABI = [
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

export const ENTRY_POINT_ABI = [
  {
    type: "function",
    name: "getNonce",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "depositTo",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "handleOps",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const ACCOUNT_FACTORY_ABI = [
  {
    type: "function",
    name: "getAddress",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "predicted", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createAccount",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "nonpayable",
  },
] as const;

export const SMART_ACCOUNT_ABI = [
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "entryPoint",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ type: "bytes" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeBatch",
    inputs: [
      { name: "targets", type: "address[]" },
      { name: "values", type: "uint256[]" },
      { name: "data", type: "bytes[]" },
    ],
    outputs: [{ type: "bytes[]" }],
    stateMutability: "nonpayable",
  },
] as const;

export const BATCH_PAYMENTS_ABI = [
  {
    type: "function",
    name: "batchPay",
    inputs: [
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "batchId", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "BatchPaid",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "recipients", type: "address[]", indexed: false },
      { name: "amounts", type: "uint256[]", indexed: false },
      { name: "batchId", type: "bytes32", indexed: true },
    ],
  },
] as const;

export const PAYMENT_REQUEST_ABI = [
  {
    type: "function",
    name: "createRequest",
    inputs: [
      { name: "payer", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "bytes32" },
      { name: "expiryDelta", type: "uint64" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "payRequest",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelRequest",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getRequest",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        name: "request",
        components: [
          { name: "requestor", type: "address" },
          { name: "payer", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "memo", type: "bytes32" },
          { name: "expiry", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const RECEIPT_REGISTRY_ABI = [
  {
    type: "function",
    name: "createReceipt",
    inputs: [
      { name: "payer", type: "address" },
      { name: "payee", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "amountPrivate", type: "bool" },
      { name: "metadataHash", type: "bytes32" },
      { name: "paymentReference", type: "bytes32" },
      { name: "receiptType", type: "uint8" },
    ],
    outputs: [{ name: "receiptId", type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getReceipt",
    inputs: [{ name: "receiptId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        name: "receipt",
        components: [
          { name: "receiptId", type: "bytes32" },
          { name: "payer", type: "address" },
          { name: "payee", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "amountPrivate", type: "bool" },
          { name: "metadataHash", type: "bytes32" },
          { name: "paymentReference", type: "bytes32" },
          { name: "receiptType", type: "uint8" },
          { name: "timestamp", type: "uint64" },
          { name: "issuer", type: "address" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReceiptsByPayer",
    inputs: [{ name: "payer", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReceiptsByPayee",
    inputs: [{ name: "payee", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "authorizedIssuers",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ReceiptCreated",
    inputs: [
      { name: "receiptId", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "amountPrivate", type: "bool", indexed: false },
      { name: "metadataHash", type: "bytes32", indexed: false },
      { name: "paymentReference", type: "bytes32", indexed: false },
      { name: "receiptType", type: "uint8", indexed: false },
      { name: "issuer", type: "address", indexed: false },
      { name: "timestamp", type: "uint64", indexed: false },
    ],
  },
] as const;

export const SUBSCRIPTION_MANAGER_ABI = [
  {
    type: "function",
    name: "subscribe",
    inputs: [
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "period", type: "uint64" },
      { name: "maxPayments", type: "uint256" },
      { name: "startAt", type: "uint64" },
    ],
    outputs: [{ name: "subId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "charge",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancel",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getSubscription",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        name: "sub",
        components: [
          { name: "payer", type: "address" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "period", type: "uint64" },
          { name: "maxPayments", type: "uint256" },
          { name: "paymentsMade", type: "uint256" },
          { name: "nextChargeAt", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isDue",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
] as const;

export const USERNAME_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    inputs: [{ name: "username", type: "string" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "release",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "resolve",
    inputs: [{ name: "username", type: "string" }],
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reverseResolve",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
] as const;

export const QIE_DOMAINS_ABI = [
  {
    type: "function",
    name: "userDomain",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "domainExist",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
] as const;

export const PAYMASTER_ABI = [
  {
    type: "function",
    name: "quoteQUSDC",
    inputs: [{ name: "gasCostWei", type: "uint256" }],
    outputs: [{ name: "qusdcAmount", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "remainingFreeOps",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;
