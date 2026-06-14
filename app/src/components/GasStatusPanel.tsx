import React from "react";
import { type GasStatus, formatQusdc } from "../lib/useGasStatus.js";

/**
 * Honest, compact gas panel for payment previews and the wallet. Qevie never
 * claims unlimited free gas: it shows the sponsored onboarding quota, then the
 * QUSDC gas charge, then a clear "add QUSDC" prompt if the user can't pay.
 */
export function GasStatusPanel({
  status,
  variant = "panel",
}: {
  status: GasStatus;
  variant?: "panel" | "inline";
}): React.ReactElement {
  const { loading, arming, uiMode, sponsoredRemaining, estimatedQusdcGas, reason } = status;

  let title: string;
  let detail: string;
  let tone: "good" | "info" | "warn";

  if (loading) {
    title = "Gas mode";
    detail = "Checking…";
    tone = "info";
  } else if (arming) {
    title = "Setting up USDC gas";
    detail = "One time approval so you can pay fees in USDC later…";
    tone = "info";
  } else if (uiMode === "SPONSORED_ONBOARDING") {
    title = "Sponsored onboarding";
    detail = `${sponsoredRemaining} / 3 free actions left · you pay 0 gas`;
    tone = "good";
  } else if (uiMode === "QUSDC_GAS") {
    title = "USDC gas";
    detail = `Network fee ≈ ${formatQusdc(estimatedQusdcGas)} USDC · paid from your USDC via QIEDex (WQIE → USDC)`;
    tone = "info";
  } else {
    title = "Add USDC to continue";
    detail = reason ?? "You need USDC to pay the network fee.";
    tone = "warn";
  }

  const colors: Record<typeof tone, { bg: string; fg: string; bd: string }> = {
    good: { bg: "#ecfdf5", fg: "#065f46", bd: "#a7f3d0" },
    info: { bg: "#eff6ff", fg: "#1e40af", bd: "#bfdbfe" },
    warn: { bg: "#fffbeb", fg: "#92400e", bd: "#fde68a" },
  };
  const c = colors[tone];

  if (variant === "inline") {
    return (
      <span style={{ color: c.fg, fontSize: 13 }}>
        {title}: {detail}
      </span>
    );
  }

  return (
    <div
      style={{
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ opacity: 0.9 }}>{detail}</div>
    </div>
  );
}
