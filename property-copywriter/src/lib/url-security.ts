import { isIP } from "node:net";

const allowedHosts = new Set(["zonere.ro", "www.zonere.ro"]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

export function validatePropertyUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL-ul nu este valid. Verifică adresa și încearcă din nou.");
  }

  if (url.protocol !== "https:") throw new Error("Este permis doar protocolul HTTPS.");
  if (url.username || url.password) throw new Error("URL-urile care conțin credențiale nu sunt permise.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || isPrivateIpv4(host) || isPrivateIpv6(host) || isIP(host) !== 0) {
    throw new Error("Adresele locale, private sau IP nu sunt permise.");
  }
  if (!allowedHosts.has(host)) throw new Error("Momentan sunt acceptate doar proprietăți de pe zonere.ro.");
  url.hash = "";
  return url;
}
