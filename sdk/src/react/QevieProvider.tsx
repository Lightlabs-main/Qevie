import React, { createContext, useContext, useMemo } from "react";
import { createQevieClient, QevieClient } from "../client.js";
import type { QevieClientConfig } from "../types.js";

interface QevieContextValue {
  client: QevieClient;
}

const QevieContext = createContext<QevieContextValue | null>(null);

interface QevieProviderProps {
  config: QevieClientConfig;
  children: React.ReactNode;
}

export function QevieProvider({ config, children }: QevieProviderProps): React.ReactElement {
  const client = useMemo(() => createQevieClient(config), [config]);

  return (
    <QevieContext.Provider value={{ client }}>
      {children}
    </QevieContext.Provider>
  );
}

export function useQevieContext(): QevieContextValue {
  const ctx = useContext(QevieContext);
  if (ctx === null) {
    throw new Error("useQevieContext must be used inside <QevieProvider>");
  }
  return ctx;
}
