import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isBlockedAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower)) return true;
  const mapped = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  if (isIP(mapped) !== 4) return false;
  const [a, b] = mapped.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    a >= 224;
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Destinația locală a fost blocată.");
  }
  const results = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!results.length || results.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("Destinația rezolvă către o adresă locală sau privată.");
  }
}

export async function isSafeBrowserRequest(rawUrl: string): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    await assertPublicHostname(url.hostname);
    return true;
  } catch {
    return false;
  }
}
