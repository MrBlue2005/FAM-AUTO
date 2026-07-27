import type { PropertyData } from "./schemas";

export function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!clean) return null;
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  const separator = Math.max(comma, dot);
  const digitsAfter = separator >= 0 ? clean.length - separator - 1 : 0;
  const sameSeparatorCount = separator >= 0 ? clean.split(clean[separator]).length - 1 : 0;
  const isThousands = separator >= 0 && digitsAfter === 3 &&
    (sameSeparatorCount === 1 || clean.split(clean[separator]).slice(1).every((group) => group.length === 3));
  const decimal = separator < 0 ? clean
    : isThousands ? clean.replace(/[.,]/g, "")
    : `${clean.slice(0, separator).replace(/[.,]/g, "")}.${clean.slice(separator + 1)}`;
  const parsed = Number(decimal);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  if (upper.includes("EUR") || upper.includes("€")) return "EUR";
  if (upper.includes("RON") || upper.includes("LEI")) return "RON";
  if (upper.includes("USD") || upper.includes("$")) return "USD";
  return null;
}

export function emptyProperty(sourceUrl: string): PropertyData {
  return {
    sourceUrl, title: null, transactionType: null, propertyType: null, city: null, area: null,
    address: null, price: null, currency: null, rooms: null, bedrooms: null, bathrooms: null,
    usableAreaSqm: null, totalAreaSqm: null, landAreaSqm: null, terraceAreaSqm: null, floor: null,
    totalFloors: null, constructionYear: null, layout: null, parkingSpaces: null, storageUnits: null,
    features: [], amenities: [], originalDescription: null, images: [], additionalDetails: {},
  };
}

export function uniqueText(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
