import React from "react";
import { useNavigate } from "react-router-dom";

/**
 * Back affordance for inner pages reached from the Control Center / Manual Rails
 * (Wallet, History, Send, Links, …). Those pages are not in the bottom nav, so
 * without this there is no way back to the general page on mobile/PWA. Goes to
 * the previous history entry, falling back to the Control Center root.
 */
export default function BackButton(): React.ReactElement {
  const navigate = useNavigate();
  const goBack = (): void => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };
  return (
    <button className="back-btn" onClick={goBack} aria-label="Go back" title="Back">
      ←
    </button>
  );
}
