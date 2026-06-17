import React from "react";
import BackButton from "../components/BackButton.js";

const REPO_URL = "https://github.com/Lightlabs-main/Qevie";

export default function Developers(): React.ReactElement {
  return (
    <main className="page fade-in">
      <div className="page-header">
        <BackButton />
        <h2 className="page-title">Developers</h2>
      </div>
      <p className="text-muted" style={{ marginBottom: "var(--s-3)" }}>
        Build gasless QUSDC payments with Qevie. Add paymaster rails, receipts, and Passport stats to your QIE app.
      </p>

      <Section
        title="Install"
        code={`pnpm add github:Lightlabs-main/Qevie\n\n# after npm publish\npnpm add @qevie/sdk\n\n# local development\ngit clone ${REPO_URL}\ncd Qevie\npnpm install\npnpm -r build`}
      />

      <Section
        title="Create Client"
        code={`import { createQevieClient } from "@qevie/sdk";\n\nconst qevie = createQevieClient({\n  chainId: 1990,\n  rpcUrl: "https://rpc1mainnet.qie.digital/",\n  paymasterServiceUrl: "https://your-paymaster-url",\n  bundlerUrl: "https://your-bundler-url",\n  contracts: {\n    qusdc: "0x...",\n    receiptRegistry: "0x..." // set after deploy + verify\n  }\n});`}
      />

      <Section
        title="Gasless Payment"
        code={`await qevie.pay(signer, {\n  to: "0xRecipient",\n  amount: BigInt(10_000_000),\n  memo: "Thanks"\n});`}
      />

      <Section
        title="Create Receipt"
        code={`await qevie.receipts.createReceipt({\n  payer: "0xPayer",\n  payee: "0xPayee",\n  token: "0xQUSDC",\n  amount: "10",\n  amountPrivate: false,\n  receiptType: "SINGLE_PAYMENT",\n  metadata: {\n    memo: "Thanks",\n    orderId: "ORDER-001"\n  }\n});`}
      />

      <Section
        title="Read Passport"
        code={`const passport = await qevie.passport.getPassport("0xMerchant");\nconsole.log(passport.totalReceipts);`}
      />

      <div className="surface-card">
        <div className="section-label">GitHub</div>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="history-link">
          {REPO_URL}
        </a>
      </div>
    </main>
  );
}

function Section({ title, code }: { title: string; code: string }): React.ReactElement {
  return (
    <div className="surface-card" style={{ marginBottom: "var(--s-3)" }}>
      <div className="flex-between" style={{ marginBottom: "var(--s-2)", gap: "var(--s-2)" }}>
        <div className="section-label">{title}</div>
        <button className="btn-secondary btn-sm" onClick={() => { void navigator.clipboard.writeText(code); }}>
          Copy
        </button>
      </div>
      <pre style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        fontSize: "0.8rem",
        lineHeight: 1.55,
        color: "var(--text)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
