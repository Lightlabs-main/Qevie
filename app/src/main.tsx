import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QevieProvider } from "@qevie/sdk/react";
import { APP_CONFIG } from "./config.js";
import { WalletProvider } from "./hooks/useWallet.js";
import App from "./App.js";
import "./index.css";

const publicHosts = new Set(["qevie.xyz", "www.qevie.xyz", "qevie.duckdns.org"]);

async function clearLegacyPwaCaches(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!publicHosts.has(window.location.hostname)) return;

  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs ?? []).map((reg) => reg.unregister()));
  } catch {
    /* ignore */
  }

  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    /* ignore */
  }
}

const root = document.getElementById("root");
if (root === null) throw new Error("Root element not found");

void clearLegacyPwaCaches().finally(() => {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QevieProvider config={APP_CONFIG}>
        <BrowserRouter>
          <WalletProvider>
            <App />
          </WalletProvider>
        </BrowserRouter>
      </QevieProvider>
    </React.StrictMode>,
  );
});
