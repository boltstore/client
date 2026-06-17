export function decodeJwtPayload(token: string): { exp?: number; [key: string]: unknown } | null {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as { exp?: number; [key: string]: unknown };
  } catch {
    return null;
  }
}