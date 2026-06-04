import { useQevieContext } from "./QevieProvider.js";
import type { QevieClient } from "../client.js";

export function useQevieClient(): QevieClient {
  return useQevieContext().client;
}
