export function decodeJwtPayload(token: string): { exp?: number; [key: string]: unknown } | null {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof globalThis.atob === "function"
      ? globalThis.atob(base64)
      : Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json) as { exp?: number; [key: string]: unknown };
  } catch {
    return null;
  }
}