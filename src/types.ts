export interface ClientConfig {
  baseUrl: string;
  databaseId: string;
  apiKey?: string;
}

export interface HealthCheck {
  status: string;
  version: string;
  databases: number;
  uptime_seconds?: number;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
