export interface ApiResponse<T = unknown> {
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

import { createHealthApi } from "./api/health";
import type { ClientConfig, HealthCheck } from "./types";

export class BoltstoreClient {
  private baseUrl: string;
  private databaseId: string;
  private apiKey: string | undefined;

  health: ReturnType<typeof createHealthApi>;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.databaseId = config.databaseId;
    this.apiKey = config.apiKey;
    this.health = createHealthApi(this);
  }

  getToken(): string | undefined {
    return this.apiKey;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await globalThis.fetch(`${this.baseUrl}${path}`, init);
    const text = await response.text();
    if (text) {
      const json = JSON.parse(text);
      if (json.error) throw new Error(json.error.message || "Request failed");
      return json as ApiResponse<T>;
    }
    return {} as ApiResponse<T>;
  }

  dbPath(path: string): string {
    return `/api/${this.databaseId}${path}`;
  }
}
