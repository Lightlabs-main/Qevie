import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { QevieClient } from "./client.js";
import { hashReceiptMetadata, stableStringify } from "./receipts.js";
import type { QevieClientConfig, QevieReceipt } from "./types.js";

describe("receipts helpers", () => {
  it("stableStringify is deterministic for object key order", () => {
    const left = stableStringify({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const right = stableStringify({ nested: { x: 1, y: 2 }, a: 1, b: 2 });
    expect(left).toBe(right);
  });

  it("hashReceiptMetadata is deterministic", () => {
    const left = hashReceiptMetadata({ orderId: "1", memo: "Thanks" });
    const right = hashReceiptMetadata({ memo: "Thanks", orderId: "1" });
    expect(left).toBe(right);
  });
});

describe("passport helpers", () => {
  it("aggregates receipts into passport stats", async () => {
    class TestClient extends QevieClient {
      private readonly fixtures: QevieReceipt[];

      constructor(config: QevieClientConfig, fixtures: QevieReceipt[]) {
        super(config);
        this.fixtures = fixtures;
      }

      override async listForAccount(): Promise<QevieReceipt[]> {
        return this.fixtures;
      }

      override async getReceipt(receiptId: Hex): Promise<QevieReceipt> {
        const receipt = this.fixtures.find((item) => item.receiptId === receiptId);
        if (receipt === undefined) throw new Error("missing receipt");
        return receipt;
      }
    }

    const account = "0x0000000000000000000000000000000000000abc" as Address;
    const counterparty = "0x0000000000000000000000000000000000000def" as Address;
    const config: QevieClientConfig = {
      chainId: 1983,
      rpcUrl: "https://rpc1testnet.qie.digital/",
      bundlerUrl: "http://localhost:4337",
      paymasterServiceUrl: "http://localhost:3001",
      contracts: {
        entryPoint: "0x0000000000000000000000000000000000000001",
        accountFactory: "0x0000000000000000000000000000000000000002",
        paymaster: "0x0000000000000000000000000000000000000003",
        batchPayments: "0x0000000000000000000000000000000000000004",
        paymentRequest: "0x0000000000000000000000000000000000000005",
        subscriptionManager: "0x0000000000000000000000000000000000000006",
        usernameRegistry: "0x0000000000000000000000000000000000000007",
        receiptRegistry: "0x0000000000000000000000000000000000000008",
        qusdc: "0x0000000000000000000000000000000000000009",
        wqie: "0x0000000000000000000000000000000000000010",
        dexPair: "0x0000000000000000000000000000000000000011",
      },
    };
    const fixtures: QevieReceipt[] = [
      {
        receiptId: "0x01",
        payer: account,
        payee: counterparty,
        token: config.contracts.qusdc,
        tokenSymbol: "QUSDC",
        amount: "10.00",
        amountPrivate: false,
        metadataHash: "0x11",
        receiptType: "SINGLE_PAYMENT",
        timestamp: 2,
        issuer: counterparty,
      },
      {
        receiptId: "0x02",
        payer: counterparty,
        payee: account,
        token: config.contracts.qusdc,
        tokenSymbol: "QUSDC",
        amount: "15.00",
        amountPrivate: false,
        metadataHash: "0x12",
        receiptType: "MERCHANT_CHECKOUT",
        timestamp: 3,
        issuer: counterparty,
      },
      {
        receiptId: "0x03",
        payer: account,
        payee: counterparty,
        token: config.contracts.qusdc,
        tokenSymbol: "QUSDC",
        amount: null,
        amountPrivate: true,
        metadataHash: "0x13",
        receiptType: "BATCH_PAYMENT",
        timestamp: 4,
        issuer: counterparty,
      },
    ];

    const client = new TestClient(config, fixtures);
    const passport = await client.getPassport(account);
    expect(passport.totalReceipts).toBe(3);
    expect(passport.paymentsSent).toBe(2);
    expect(passport.paymentsReceived).toBe(1);
    expect(passport.batchPayoutsSent).toBe(1);
    expect(passport.merchantReceiptsReceived).toBe(1);
    expect(passport.volumePrivate).toBe(true);
  });

  it("exports receipt json with private amount hidden", async () => {
    class TestClient extends QevieClient {
      override async getReceipt(): Promise<QevieReceipt> {
        return {
          receiptId: "0x99",
          payer: "0x0000000000000000000000000000000000000001",
          payee: "0x0000000000000000000000000000000000000002",
          token: "0x0000000000000000000000000000000000000003",
          tokenSymbol: "QUSDC",
          amount: null,
          amountPrivate: true,
          metadataHash: "0x44",
          receiptType: "SINGLE_PAYMENT",
          timestamp: 1,
          issuer: "0x0000000000000000000000000000000000000004",
        };
      }
    }

    const client = new TestClient({
      chainId: 1983,
      rpcUrl: "https://rpc1testnet.qie.digital/",
      bundlerUrl: "http://localhost:4337",
      paymasterServiceUrl: "http://localhost:3001",
      contracts: {
        entryPoint: "0x0000000000000000000000000000000000000001",
        accountFactory: "0x0000000000000000000000000000000000000002",
        paymaster: "0x0000000000000000000000000000000000000003",
        batchPayments: "0x0000000000000000000000000000000000000004",
        paymentRequest: "0x0000000000000000000000000000000000000005",
        subscriptionManager: "0x0000000000000000000000000000000000000006",
        usernameRegistry: "0x0000000000000000000000000000000000000007",
        receiptRegistry: "0x0000000000000000000000000000000000000008",
        qusdc: "0x0000000000000000000000000000000000000009",
        wqie: "0x0000000000000000000000000000000000000010",
        dexPair: "0x0000000000000000000000000000000000000011",
      },
    });

    const exported = await client.exportReceipt("0x99");
    expect(exported).toContain("\"amount\": null");
    expect(exported).toContain("\"amountPrivate\": true");
  });
});
