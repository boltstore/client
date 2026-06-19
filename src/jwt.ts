function base64Decode(str: string): string {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(str);
  }
  // Fallback for non-browser environments
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let output = "";
  str = str.replace(/=+$/, "");
  for (let i = 0; i < str.length; i += 4) {
    const a = chars.indexOf(str[i]);
    const b = chars.indexOf(str[i + 1]);
    const c = chars.indexOf(str[i + 2]);
    const d = chars.indexOf(str[i + 3]);
    output += String.fromCharCode((a << 2) | (b >> 4));
    if (c !== -1) output += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (d !== -1) output += String.fromCharCode(((c & 3) << 6) | d);
  }
  return output;
}

export function decodeJwtPayload(token: string): { exp?: number; [key: string]: unknown } | null {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = base64Decode(base64);
    return JSON.parse(json) as { exp?: number; [key: string]: unknown };
  } catch {
    return null;
  }
}
