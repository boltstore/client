import type { Filter } from "@boltstore/utils";

function getFieldValue(record: Record<string, unknown>, field: string): unknown {
  const parts = field.split(".");
  let val: unknown = record;
  for (const part of parts) {
    if (val == null || typeof val !== "object") return undefined;
    val = (val as Record<string, unknown>)[part];
  }
  return val;
}

function matchesCondition(record: Record<string, unknown>, field: string, condition: unknown): boolean {
  const val = getFieldValue(record, field);

  if (condition === null || condition === undefined) {
    return val === null || val === undefined;
  }

  if (typeof condition !== "object" || Array.isArray(condition)) {
    return val === condition;
  }

  const ops = condition as Record<string, unknown>;
  for (const [op, expected] of Object.entries(ops)) {
    let matched = false;
    switch (op) {
      case "$eq":
        matched = val === expected;
        break;
      case "$neq":
        matched = val !== expected;
        break;
      case "$gt":
        matched = typeof val === "number" && typeof expected === "number" && val > expected;
        break;
      case "$gte":
        matched = typeof val === "number" && typeof expected === "number" && val >= expected;
        break;
      case "$lt":
        matched = typeof val === "number" && typeof expected === "number" && val < expected;
        break;
      case "$lte":
        matched = typeof val === "number" && typeof expected === "number" && val <= expected;
        break;
      case "$in":
        matched = Array.isArray(expected) && expected.includes(val);
        break;
      case "$nin":
        matched = !Array.isArray(expected) || !expected.includes(val);
        break;
      case "$contains":
        matched = typeof val === "string" && typeof expected === "string" && val.includes(expected);
        break;
      case "$startsWith":
        matched = typeof val === "string" && typeof expected === "string" && val.startsWith(expected);
        break;
      case "$endsWith":
        matched = typeof val === "string" && typeof expected === "string" && val.endsWith(expected);
        break;
      case "$exists":
        matched = (expected === true || expected === 1) ? val !== undefined : val === undefined;
        break;
      case "$regexp":
        if (typeof expected === "string" && typeof val === "string") {
          try {
            matched = new RegExp(expected).test(val);
          } catch {
            matched = false;
          }
        }
        break;
      default:
        return false;
    }
    if (!matched) return false;
  }
  return true;
}

export function evaluateFilter(record: Record<string, unknown>, filter: Filter): boolean {
  if (filter == null) return true;

  const isCondition = (f: Filter): f is Record<string, unknown> & { [key: string]: unknown } => {
    return typeof f === "object" && !Array.isArray(f) && f !== null;
  };

  if (!isCondition(filter)) return true;

  const f = filter as Record<string, unknown>;

  if (f.$and !== undefined && Array.isArray(f.$and)) {
    return f.$and.every((sub: Filter) => evaluateFilter(record, sub));
  }

  if (f.$or !== undefined && Array.isArray(f.$or)) {
    return f.$or.some((sub: Filter) => evaluateFilter(record, sub));
  }

  if (f.$not !== undefined) {
    return !evaluateFilter(record, f.$not as Filter);
  }

  for (const [key, value] of Object.entries(f)) {
    if (key.startsWith("$")) continue;
    if (!matchesCondition(record, key, value)) return false;
  }

  return true;
}

export function evaluateSimpleFilter(record: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (getFieldValue(record, key) !== value) return false;
  }
  return true;
}

export function matchesSearch(record: Record<string, unknown>, query: string, fields?: string[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const candidates = fields ?? Object.keys(record);
  for (const field of candidates) {
    const val = record[field];
    if (typeof val === "string" && val.toLowerCase().includes(q)) return true;
    if (typeof val === "number" && String(val).includes(q)) return true;
  }
  return false;
}

export function applySort(
  records: Record<string, unknown>[],
  sort?: string | Array<{ field: string; direction: "asc" | "desc" }>,
  direction?: "asc" | "desc"
): Record<string, unknown>[] {
  if (!sort) return records;

  const sorts: Array<{ field: string; direction: "asc" | "desc" }> = [];

  if (typeof sort === "string") {
    sorts.push({ field: sort, direction: direction ?? "asc" });
  } else if (Array.isArray(sort)) {
    sorts.push(...sort);
  }

  if (sorts.length === 0) return records;

  return [...records].sort((a, b) => {
    for (const s of sorts) {
      const av = a[s.field];
      const bv = b[s.field];
      let cmp = 0;

      if (av == null && bv == null) cmp = 0;
      else if (av == null) cmp = -1;
      else if (bv == null) cmp = 1;
      else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));

      if (cmp !== 0) return s.direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}
