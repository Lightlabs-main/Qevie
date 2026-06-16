/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_TESTNET?: string;
  readonly VITE_TESTNET_RPC?: string;
  readonly VITE_MAINNET_RPC?: string;
  readonly VITE_BUNDLER_URL?: string;
  readonly VITE_PAYMASTER_SERVICE_URL?: string;
  readonly VITE_STATS_API_URL?: string;
  readonly VITE_APP_BASE_URL?: string;
  readonly VITE_SKIP_CONTRACT_CHECK?: string;
  readonly VITE_AGENT_POLICY_MANAGER_ADDRESS?: string;
  readonly VITE_AUTOPILOT_EXECUTION_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
