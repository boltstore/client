import { QueryBuilder } from "@boltstore/utils";
import type { QueryOptions, AggregateSpec, PaginationMeta } from "@boltstore/utils";
import { BoltstoreError } from "./errors";
import type { LocalStore } from "./store/types";

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface QueryResponse<T> {
  data: T[];
  meta: Record<string, unknown>;
}

export class ClientQueryBuilder<T = Record<string, unknown>> extends QueryBuilder {
  private sendQuery: (params: QueryOptions) => Promise<QueryResponse<T>>;
  private localStore: LocalStore | null;

  constructor(
    sendQuery: (params: QueryOptions) => Promise<QueryResponse<T>>,
    localStore: LocalStore | null,
  ) {
    super();
    this.sendQuery = sendQuery;
    this.localStore = localStore;
  }

  async get(): Promise<T[]> {
    const params = this.toParams();
    const result = await this.sendQuery(params);
    return result.data;
  }

  async first(): Promise<T | null> {
    const cloned = this.clone();
    cloned.limit(1);
    const data = await cloned.get();
    return data[0] ?? null;
  }

  async count(): Promise<number> {
    const cloned = this.clone() as ClientQueryBuilder<T>;
    cloned.aggregate({ function: "$count", field: "*", alias: "count" });
    const params = cloned.toParams();
    const result = await this.sendQuery(params);
    const row = result.data[0] as Record<string, unknown> | undefined;
    return (row?.count as number) ?? 0;
  }

  async paginate(page: number, perPage: number = 50): Promise<PaginatedResult<T>> {
    const cloned = this.clone() as ClientQueryBuilder<T>;
    cloned.limit(perPage).offset((page - 1) * perPage);
    const params = cloned.toParams();
    const result = await this.sendQuery(params);
    return {
      data: result.data,
      meta: {
        page,
        per_page: perPage,
        total: (result.meta?.total as number) ?? result.data.length,
        total_pages: Math.ceil(((result.meta?.total as number) ?? result.data.length) / perPage) || 1,
      },
    };
  }

  clone(): ClientQueryBuilder<T> {
    const cloned = new ClientQueryBuilder<T>(this.sendQuery, this.localStore);
    cloned.state = this.cloneState(this.state);
    return cloned;
  }
}
