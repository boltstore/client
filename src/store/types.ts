import type { Filter, QueryOptions } from "@boltstore/utils";

export interface QueryResult {
  data: Record<string, unknown>[];
  meta: Record<string, unknown>;
}

export interface LocalStore {
  insert(collection: string, records: Record<string, unknown>[]): Promise<void>;
  update(collection: string, id: string, data: Record<string, unknown>): Promise<void>;
  delete(collection: string, id: string): Promise<void>;

  find(collection: string, filter?: Record<string, unknown>, options?: {
    sort?: string;
    direction?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }): Promise<Record<string, unknown>[]>;

  get(collection: string, id: string): Promise<Record<string, unknown> | null>;
  count(collection: string, filter?: Record<string, unknown>): Promise<number>;
  distinct(collection: string, field: string): Promise<unknown[]>;

  query(options: QueryOptions): Promise<QueryResult>;

  applyChanges(collection: string, changes: Array<{
    event: "create" | "update" | "delete";
    recordId: string | null;
    record: Record<string, unknown>;
    previous?: Record<string, unknown> | null;
  }>): Promise<void>;

  close?(): Promise<void>;
}

export type { Filter, QueryOptions };
