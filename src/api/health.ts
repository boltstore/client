import type { BoltstoreClient } from "../client";
import type { HealthCheck } from "../types";

export function createHealthApi(client: BoltstoreClient) {
  return {
    check: async (): Promise<HealthCheck> => {
      const res = await client.request<HealthCheck>("GET", "/api/health");
      return res.data ?? { status: "unknown", version: "", uptime: 0, timestamp: "" };
    },
  };
}
