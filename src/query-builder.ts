import { QueryBuilder } from "@boltstore/utils";
import type { QueryOptions, PaginationMeta } from "@boltstore/utils";
import type { LocalStore } from "./store/types";

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface QueryResponse<T> {
  data: T[];
  meta: Record<string, unknown>;
}

export type SelectResult<T, K extends keyof T> = Pick<T, K> & { id: string; created_at: string; updated_at: string };
export type JoinResult<T, J> = T & J;

type JoinOnEntry = { left: string; operator?: "=" | "!=" | ">" | ">=" | "<" | "<="; right: string };
type QueryCb = (q: QueryBuilder) => void;

export class ClientQueryBuilder<T = Record<string, unknown>> {
  private inner: QueryBuilder;
  private sendQuery: (params: QueryOptions) => Promise<QueryResponse<unknown>>;
  private localStore: LocalStore | null;

  constructor(
    sendQuery: (params: QueryOptions) => Promise<QueryResponse<unknown>>,
    localStore: LocalStore | null,
  ) {
    this.inner = new QueryBuilder();
    this.sendQuery = sendQuery;
    this.localStore = localStore;
  }

  // -- Terminal methods --

  async get(): Promise<T[]> {
    const params = this.inner.toParams();
    const result = await this.sendQuery(params);
    return result.data as T[];
  }

  async first(): Promise<T | null> {
    const cloned = this.clone();
    cloned.inner.limit(1);
    const data = await cloned.get();
    return data[0] ?? null;
  }

  async count(): Promise<number> {
    const cloned = this.clone();
    cloned.inner.aggregate({ function: "$count", field: "*", alias: "count" });
    const params = cloned.inner.toParams();
    const result = await this.sendQuery(params);
    const row = result.data[0] as Record<string, unknown> | undefined;
    return (row?.count as number) ?? 0;
  }

  async paginate(page: number, perPage: number = 50): Promise<PaginatedResult<T>> {
    const cloned = this.clone();
    cloned.inner.limit(perPage).offset((page - 1) * perPage);
    const params = cloned.inner.toParams();
    const result = await this.sendQuery(params);
    return {
      data: result.data as T[],
      meta: {
        page,
        per_page: perPage,
        total: (result.meta?.total as number) ?? result.data.length,
        total_pages: Math.ceil(((result.meta?.total as number) ?? result.data.length) / perPage) || 1,
      },
    };
  }

  // -- Type-narrowing methods (chain return type changes) --

  select<K extends keyof T & string>(...fields: K[]): ClientQueryBuilder<Pick<T, K>> {
    this.inner.select(...fields);
    return this as unknown as ClientQueryBuilder<Pick<T, K>>;
  }

  join<J>(target: string, on?: JoinOnEntry[]): ClientQueryBuilder<Omit<T, keyof J> & J> {
    this.inner.join(target, on);
    return this as unknown as ClientQueryBuilder<Omit<T, keyof J> & J>;
  }

  leftJoin<J>(target: string, on?: JoinOnEntry[]): ClientQueryBuilder<Omit<T, keyof J> & J> {
    this.inner.leftJoin(target, on);
    return this as unknown as ClientQueryBuilder<Omit<T, keyof J> & J>;
  }

  with<R = {}>(relations: Record<string, boolean | import("@boltstore/utils").WithRelation>): ClientQueryBuilder<Omit<T, keyof R> & R> {
    this.inner.with(relations);
    return this as unknown as ClientQueryBuilder<Omit<T, keyof R> & R>;
  }

  // -- Field-validating methods (field param narrowed to keyof T) --

  from(collection: string): this { this.inner.from(collection); return this; }

  where<K extends keyof T & string>(field: K, operator?: unknown, value?: unknown): this;
  where(field: QueryCb): this;
  where(field: string | QueryCb, operator?: unknown, value?: unknown): this {
    this.inner.where(field as any, operator, value);
    return this;
  }

  orWhere<K extends keyof T & string>(field: K, operator?: unknown, value?: unknown): this;
  orWhere(field: QueryCb): this;
  orWhere(field: string | QueryCb, operator?: unknown, value?: unknown): this {
    this.inner.orWhere(field as any, operator, value);
    return this;
  }

  whereEq<K extends keyof T & string>(field: K, value: unknown): this { this.inner.whereEq(field, value); return this; }
  orWhereEq<K extends keyof T & string>(field: K, value: unknown): this { this.inner.orWhereEq(field, value); return this; }
  whereNeq<K extends keyof T & string>(field: K, value: unknown): this { this.inner.whereNeq(field, value); return this; }
  orWhereNeq<K extends keyof T & string>(field: K, value: unknown): this { this.inner.orWhereNeq(field, value); return this; }
  whereGt<K extends keyof T & string>(field: K, value: unknown): this { this.inner.whereGt(field, value); return this; }
  orWhereGt<K extends keyof T & string>(field: K, value: unknown): this { this.inner.orWhereGt(field, value); return this; }
  whereGte<K extends keyof T & string>(field: K, value: unknown): this { this.inner.whereGte(field, value); return this; }
  orWhereGte<K extends keyof T & string>(field: K, value: unknown): this { this.inner.orWhereGte(field, value); return this; }
  whereLt<K extends keyof T & string>(field: K, value: unknown): this { this.inner.whereLt(field, value); return this; }
  orWhereLt<K extends keyof T & string>(field: K, value: unknown): this { this.inner.orWhereLt(field, value); return this; }
  whereLte<K extends keyof T & string>(field: K, value: unknown): this { this.inner.whereLte(field, value); return this; }
  orWhereLte<K extends keyof T & string>(field: K, value: unknown): this { this.inner.orWhereLte(field, value); return this; }
  whereIn<K extends keyof T & string>(field: K, value: unknown[]): this { this.inner.whereIn(field, value); return this; }
  orWhereIn<K extends keyof T & string>(field: K, value: unknown[]): this { this.inner.orWhereIn(field, value); return this; }
  whereNotIn<K extends keyof T & string>(field: K, value: unknown[]): this { this.inner.whereNotIn(field, value); return this; }
  orWhereNotIn<K extends keyof T & string>(field: K, value: unknown[]): this { this.inner.orWhereNotIn(field, value); return this; }
  whereNull<K extends keyof T & string>(field: K): this { this.inner.whereNull(field); return this; }
  orWhereNull<K extends keyof T & string>(field: K): this { this.inner.orWhereNull(field); return this; }
  whereNotNull<K extends keyof T & string>(field: K): this { this.inner.whereNotNull(field); return this; }
  orWhereNotNull<K extends keyof T & string>(field: K): this { this.inner.orWhereNotNull(field); return this; }
  whereBetween<K extends keyof T & string>(field: K, value: [unknown, unknown]): this { this.inner.whereBetween(field, value); return this; }
  orWhereBetween<K extends keyof T & string>(field: K, value: [unknown, unknown]): this { this.inner.orWhereBetween(field, value); return this; }
  whereNotBetween<K extends keyof T & string>(field: K, value: [unknown, unknown]): this { this.inner.whereNotBetween(field, value); return this; }
  orWhereNotBetween<K extends keyof T & string>(field: K, value: [unknown, unknown]): this { this.inner.orWhereNotBetween(field, value); return this; }
  whereLike<K extends keyof T & string>(field: K, value: string): this { this.inner.whereLike(field, value); return this; }
  orWhereLike<K extends keyof T & string>(field: K, value: string): this { this.inner.orWhereLike(field, value); return this; }
  whereGlob<K extends keyof T & string>(field: K, value: string): this { this.inner.whereGlob(field, value); return this; }
  orWhereGlob<K extends keyof T & string>(field: K, value: string): this { this.inner.orWhereGlob(field, value); return this; }

  whereNot<K extends keyof T & string>(field: K, operator?: unknown, value?: unknown): this;
  whereNot(field: QueryCb): this;
  whereNot(field: string | QueryCb, operator?: unknown, value?: unknown): this {
    this.inner.whereNot(field as any, operator, value);
    return this;
  }

  orWhereNot<K extends keyof T & string>(field: K, operator?: unknown, value?: unknown): this;
  orWhereNot(field: QueryCb): this;
  orWhereNot(field: string | QueryCb, operator?: unknown, value?: unknown): this {
    this.inner.orWhereNot(field as any, operator, value);
    return this;
  }

  whereExists<K extends keyof T & string>(field: K): this { this.inner.whereExists(field); return this; }
  orWhereExists<K extends keyof T & string>(field: K): this { this.inner.orWhereExists(field); return this; }
  whereNotExists<K extends keyof T & string>(field: K): this { this.inner.whereNotExists(field); return this; }
  orWhereNotExists<K extends keyof T & string>(field: K): this { this.inner.orWhereNotExists(field); return this; }

  whereRaw(sql: string, bindings?: unknown[]): this { this.inner.whereRaw(sql, bindings); return this; }
  orWhereRaw(sql: string, bindings?: unknown[]): this { this.inner.orWhereRaw(sql, bindings); return this; }

  orderBy<K extends keyof T & string>(field: K, direction?: "asc" | "desc"): this { this.inner.orderBy(field, direction); return this; }
  orderByRaw(sql: string): this { this.inner.orderByRaw(sql); return this; }
  orderByExpr(expr: import("@boltstore/utils").SqlExpr): this { this.inner.orderByExpr(expr); return this; }
  selectExpr(...exprs: import("@boltstore/utils").SqlExpr[]): this { this.inner.selectExpr(...exprs); return this; }
  limit(value: number): this { this.inner.limit(value); return this; }
  offset(value: number): this { this.inner.offset(value); return this; }
  page(p: number): this { this.inner.page(p); return this; }
  perPage(n: number): this { this.inner.perPage(n); return this; }
  search(term: string, fields?: string[]): this { this.inner.search(term, fields); return this; }
  expand(...relations: string[]): this { this.inner.expand(...relations); return this; }
  aggregate(spec: import("@boltstore/utils").AggregateSpec | import("@boltstore/utils").AggregateSpec[]): this { this.inner.aggregate(spec); return this; }
  groupBy<K extends keyof T & string>(...fields: K[]): this { this.inner.groupBy(...fields); return this; }
  window(spec: import("@boltstore/utils").WindowSpec | import("@boltstore/utils").WindowSpec[]): this { this.inner.window(spec); return this; }

  having<K extends keyof T & string>(field: K, operator?: unknown, value?: unknown): this;
  having(field: QueryCb): this;
  having(field: string | QueryCb, operator?: unknown, value?: unknown): this {
    this.inner.having(field as any, operator, value);
    return this;
  }

  crossJoin(target: string): this { this.inner.crossJoin(target); return this; }

  withCTE(alias: string, query: (q: QueryBuilder) => void, columns?: string[]): this {
    this.inner.with(alias, query, columns);
    return this;
  }

  union(query: (q: QueryBuilder) => void): this { this.inner.union(query); return this; }
  unionAll(query: (q: QueryBuilder) => void): this { this.inner.unionAll(query); return this; }
  intersect(query: (q: QueryBuilder) => void): this { this.inner.intersect(query); return this; }
  except(query: (q: QueryBuilder) => void): this { this.inner.except(query); return this; }

  toParams(): QueryOptions { return this.inner.toParams(); }

  clone(): ClientQueryBuilder<T> {
    const cloned = new ClientQueryBuilder<T>(this.sendQuery, this.localStore);
    cloned.inner = new QueryBuilder(JSON.parse(JSON.stringify(this.inner.state)) as any);
    return cloned;
  }
}
