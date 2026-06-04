import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QevieProvider } from "@qevie/sdk/react";
import { APP_CONFIG } from "./config.js";
import { WalletProvider } from "./hooks/useWallet.js";
import App from "./App.js";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Root element not found");

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
