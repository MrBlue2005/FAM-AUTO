import type { BrowserContext } from "playwright";
import { emptyProperty, normalizeCurrency, normalizeNumber, uniqueText } from "../normalization";
import type { PropertyData } from "../schemas";
import type { PropertySourceAdapter, RawPropertyData } from "./types";

const labels: Record<string, keyof PropertyData> = {
  pret: "price",
  tip: "propertyType",
  "tip proprietate": "propertyType",
  "tip tranzactie": "transactionType",
  camere: "rooms",
  "nr. camere": "rooms",
  dormitoare: "bedrooms",
  bai: "bathrooms",
  "nr. bai": "bathrooms",
  "suprafata utila": "usableAreaSqm",
  "suprafata construita": "totalAreaSqm",
  "suprafata totala": "totalAreaSqm",
  "suprafata teren": "landAreaSqm",
  "suprafata terasa": "terraceAreaSqm",
  etaj: "floor",
  etajul: "floor",
  niveluri: "totalFloors",
  "an constructie": "constructionYear",
  "regim de inaltime": "totalFloors",
  compartimentare: "layout",
  parcare: "parkingSpaces",
};

const featureLabels = new Set([
  "bucatarie", "mobilare", "spatii", "contorizare", "electrocasnice", "imobil",
  "sistem incalzire", "climatizare", "stadiu constructie", "structura", "pereti",
  "podele", "ferestre", "rulouri", "usa intrare", "usi interior",
]);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("ro").replace(/:$/, "").replace(/\s+/g, " ").trim();
}

function titleFromSlug(value: string): string {
  const decoded = decodeURIComponent(value).replace(/-/g, " ");
  return decoded.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("ro"));
}

function urlContext(sourceUrl: string): {
  transactionType: PropertyData["transactionType"];
  propertyType: string | null;
  city: string | null;
  area: string | null;
} {
  try {
    const segments = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    const categoryIndex = segments.findIndex((part) => /^(inchirieri|vanzari)-/.test(part));
    if (categoryIndex < 0) return { transactionType: null, propertyType: null, city: null, area: null };
    const category = segments[categoryIndex];
    const typeSlug = category.replace(/^(inchirieri|vanzari)-/, "");
    const propertyType = typeSlug.startsWith("apartament") ? "Apartament" : titleFromSlug(typeSlug);
    const citySlug = segments[categoryIndex + 1];
    const areaSlug = segments[categoryIndex + 2];
    return {
      transactionType: category.startsWith("inchirieri-") ? "rent" : "sale",
      propertyType,
      city: citySlug === "bucuresti" ? "București" : citySlug ? titleFromSlug(citySlug) : null,
      area: areaSlug ? titleFromSlug(areaSlug) : null,
    };
  } catch {
    return { transactionType: null, propertyType: null, city: null, area: null };
  }
}

function floorsFromValue(value: string): number | null {
  const matches = [...value.matchAll(/(?:P\+|\/\s*(?:P\+)?)(\d+)/gi)];
  return matches.length ? normalizeNumber(matches.at(-1)?.[1]) : null;
}

function transactionTypeFromValue(value: string): PropertyData["transactionType"] {
  const normalized = normalizeLabel(value);
  if (normalized.includes("inchiri")) return "rent";
  if (normalized.includes("vanz")) return "sale";
  return null;
}

function addressFromDescription(value: string | null): string | null {
  if (!value) return null;
  return value.match(/\b(?:Strada|Str\.?)\s+[^,.\n]{2,80}?\s+nr\.?\s*\d+[A-Za-z]?(?:,\s*Sector(?:ul)?\s+\d)?/i)?.[0]
    ?? value.match(/\b(?:Strada|Str\.?)\s+[^,.\n]{2,80}/i)?.[0]
    ?? null;
}

function firstJsonObject(items: unknown[]): Record<string, unknown> | null {
  const queue = [...items];
  while (queue.length) {
    const item = queue.shift();
    if (Array.isArray(item)) queue.push(...item);
    else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.name || record.description || record.offers) return record;
      if (Array.isArray(record["@graph"])) queue.push(...record["@graph"]);
    }
  }
  return null;
}

export function normalizeZonereRaw(raw: RawPropertyData): PropertyData {
  const result = emptyProperty(raw.sourceUrl);
  const structured = firstJsonObject(raw.jsonLd);
  const offers = structured?.offers && typeof structured.offers === "object"
    ? structured.offers as Record<string, unknown> : null;
  const structuredAddress = structured?.address && typeof structured.address === "object"
    ? structured.address as Record<string, unknown> : null;
  const fromUrl = urlContext(raw.sourceUrl);

  result.title = raw.title ?? text(structured?.name) ?? text(raw.openGraph["og:title"]);
  result.originalDescription = raw.description ?? text(structured?.description) ?? text(raw.openGraph["og:description"]);
  result.price = normalizeNumber(offers?.price);
  result.currency = normalizeCurrency(offers?.priceCurrency);
  result.city = text(structuredAddress?.addressLocality) ?? fromUrl.city;
  result.area = fromUrl.area;
  result.address = text(structuredAddress?.streetAddress) ?? addressFromDescription(result.originalDescription);
  result.propertyType = fromUrl.propertyType;
  result.transactionType = fromUrl.transactionType;
  result.images = uniqueText([
    ...raw.images,
    ...(typeof structured?.image === "string" ? [structured.image] : []),
    ...(Array.isArray(structured?.image) ? structured.image.filter((item): item is string => typeof item === "string") : []),
  ]).filter((imageUrl) => {
    try { return ["http:", "https:"].includes(new URL(imageUrl).protocol); } catch { return false; }
  }).slice(0, 30);

  const features: string[] = [];
  for (const [rawLabel, rawValue] of Object.entries(raw.facts)) {
    const normalizedLabel = normalizeLabel(rawLabel);
    const key = labels[normalizedLabel];
    if (featureLabels.has(normalizedLabel)) {
      features.push(...rawValue.split(",").map((item) => item.trim()));
    }
    if (!key) {
      if (rawLabel && rawValue) result.additionalDetails[rawLabel] = rawValue;
      continue;
    }
    if (key === "floor" || key === "layout" || key === "propertyType") result[key] = text(rawValue);
    else if (key === "constructionYear") result[key] = normalizeNumber(rawValue)?.valueOf() ?? null;
    else if (key === "transactionType") result.transactionType ??= transactionTypeFromValue(rawValue);
    else if (key === "price") {
      result.price ??= normalizeNumber(rawValue);
      result.currency ??= normalizeCurrency(rawValue);
    } else if (key === "rooms") result.rooms = normalizeNumber(rawValue);
    else if (key === "bedrooms") result.bedrooms = normalizeNumber(rawValue);
    else if (key === "bathrooms") result.bathrooms = normalizeNumber(rawValue);
    else if (key === "usableAreaSqm") result.usableAreaSqm = normalizeNumber(rawValue);
    else if (key === "totalAreaSqm") result.totalAreaSqm = normalizeNumber(rawValue);
    else if (key === "landAreaSqm") result.landAreaSqm = normalizeNumber(rawValue);
    else if (key === "terraceAreaSqm") result.terraceAreaSqm = normalizeNumber(rawValue);
    else if (key === "totalFloors") result.totalFloors = floorsFromValue(rawValue) ?? normalizeNumber(rawValue);
    else if (key === "parkingSpaces") result.parkingSpaces = normalizeNumber(rawValue);
    else if (key === "storageUnits") result.storageUnits = normalizeNumber(rawValue);
  }
  result.features = uniqueText(features);

  if (result.floor) result.totalFloors ??= floorsFromValue(result.floor);
  result.currency ??= normalizeCurrency(raw.facts.Preț) ?? normalizeCurrency(raw.pageText);

  if (!result.transactionType) {
    const combined = `${result.title ?? ""} ${result.originalDescription ?? ""}`.toLocaleLowerCase("ro");
    result.transactionType = /\b(închiriere|inchiriere|de închiriat)\b/.test(combined) ? "rent" :
      /\b(vânzare|vanzare|de vânzare|de vanzare)\b/.test(combined) ? "sale" : null;
  }
  return result;
}

export class ZonereAdapter implements PropertySourceAdapter {
  supports(url: URL): boolean {
    return ["zonere.ro", "www.zonere.ro"].includes(url.hostname.toLowerCase());
  }

  async extract(url: URL, context: BrowserContext): Promise<RawPropertyData> {
    const page = await context.newPage();
    try {
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      const finalUrl = new URL(page.url());
      if (!this.supports(finalUrl)) throw new Error("Pagina a redirecționat către un domeniu nesuportat.");
      return await page.evaluate((sourceUrl) => {
        const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || null;
        const normalized = (value: string | null | undefined) => (clean(value) ?? "")
          .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        const all = [...document.querySelectorAll<HTMLElement>("body *")];
        const marker = (label: string) => all
          .filter((element) => normalized(element.textContent) === label)
          .sort((left, right) => left.children.length - right.children.length)[0];
        const elementsBetween = (start: Element | undefined, end: Element | undefined) => {
          const from = start ? all.indexOf(start as HTMLElement) + 1 : 0;
          const to = end ? all.indexOf(end as HTMLElement) : all.length;
          return all.slice(Math.max(0, from), to < 0 ? all.length : to);
        };
        const sectionText = (startLabels: string[], endLabels: string[]) => {
          const start = startLabels.map(marker).find(Boolean);
          if (!start) return null;
          const startIndex = all.indexOf(start);
          const next = all.slice(startIndex + 1).find((element) =>
            endLabels.includes(normalized(element.textContent))
          );
          if (!next) return null;
          const range = document.createRange();
          range.setStartAfter(start);
          range.setEndBefore(next);
          const fragment = range.cloneContents();
          fragment.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith(document.createTextNode(" ")));
          return clean(fragment.textContent);
        };

        const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
          try { return [JSON.parse(node.textContent || "") as unknown]; } catch { return []; }
        });
        const openGraph: Record<string, string> = {};
        document.querySelectorAll<HTMLMetaElement>("meta[property^='og:']").forEach((meta) => {
          if (meta.getAttribute("property") && meta.content) openGraph[meta.getAttribute("property")!] = meta.content;
        });

        const facts: Record<string, string> = {};
        const detailsHeading = marker("detalii proprietate")
          ?? marker("toate caracteristicile")
          ?? marker("caracteristici");
        const descriptionHeading = marker("descriere proprietate") ?? marker("despre proprietate");
        const detailElements = elementsBetween(detailsHeading, descriptionHeading);
        detailElements.forEach((element) => {
          if (!["LI", "TR"].includes(element.tagName)) return;
          const parts = [...element.children].map((child) => clean(child.textContent)).filter((part): part is string => Boolean(part));
          if (parts.length >= 2 && parts[0].length <= 50) facts[parts[0].replace(/:$/, "")] ??= parts.slice(1).join(" ");
          const value = clean(element.textContent);
          if (!value || value.length > 160) return;
          const match = value.match(/^([^:]{2,50}):\s*(.+)$/);
          if (match) facts[match[1].trim()] ??= match[2].trim();
        });
        document.querySelectorAll("dt").forEach((dt) => {
          const dd = dt.nextElementSibling;
          if (dd?.tagName === "DD") facts[clean(dt.textContent) ?? ""] = clean(dd.textContent) ?? "";
        });
        document.querySelectorAll("tr").forEach((row) => {
          const cells = [...row.querySelectorAll("th, td")]
            .map((cell) => clean(cell.textContent)).filter((part): part is string => Boolean(part));
          if (cells.length >= 2 && cells[0].length <= 50 && !/^\d+$/.test(cells[0])) {
            facts[cells[0].replace(/:$/, "")] ??= cells.slice(1).join(", ");
          }
        });

        // Noua interfață Zonere redă detaliile ca elemente succesive (etichetă,
        // apoi valoare), nu neapărat în <li>, <tr> sau <dl>.
        const detailLabels = new Set([
          "pret", "tip", "tip proprietate", "tip tranzactie", "camere", "nr. camere",
          "dormitoare", "bai", "nr. bai", "suprafata utila", "suprafata construita",
          "suprafata totala", "suprafata teren", "suprafata terasa", "etaj", "etajul",
          "niveluri", "an constructie", "regim de inaltime", "compartimentare", "parcare",
          "nr. balcoane", "nr. terase", "stare", "orientare",
          "structura", "clasa energetica", "comision", "cod proprietate",
        ]);
        const leafTexts = all
          .filter((element) => element.children.length === 0)
          .map((element) => clean(element.textContent))
          .filter((value): value is string => typeof value === "string" && value.length <= 120);
        leafTexts.forEach((label, index) => {
          const normalizedLabel = normalized(label).replace(/:$/, "");
          if (!detailLabels.has(normalizedLabel)) return;
          const value = leafTexts[index + 1];
          if (typeof value !== "string" || detailLabels.has(normalized(value).replace(/:$/, ""))) return;
          facts[label.replace(/:$/, "")] ??= value;
        });

        const h1 = document.querySelector("h1");
        const price = elementsBetween(h1 ?? undefined, detailsHeading)
          .filter((element) => element.children.length === 0)
          .map((element) => clean(element.textContent))
          .filter((value): value is string => Boolean(value))
          .map((value) => value.match(/(\d[\d.,]*)\s*(EUR|RON|USD|€)(?:\s*\([^)]*\))?/i))
          .find(Boolean);
        if (price) facts.Preț = `${price[1]} ${price[2]}`;

        const images = [...document.querySelectorAll<HTMLImageElement>("main img, article img, [class*='gallery'] img")]
          .map((image) => image.currentSrc || image.src).filter(Boolean);
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script,style,noscript,svg,nav,footer,form").forEach((node) => node.remove());
        return {
          sourceUrl,
          title: clean(h1?.textContent) ?? clean(document.title),
          description: sectionText(
            ["descriere proprietate", "despre proprietate"],
            ["facilitati proprietate", "dotari & facilitati", "lifestyle in zona", "galerie foto", "toate caracteristicile"]
          ),
          jsonLd, openGraph, facts, images,
          pageText: (clean(clone.innerText) ?? "").slice(0, 30_000),
        };
      }, url.href);
    } finally {
      await page.close();
    }
  }

  normalize(raw: RawPropertyData): PropertyData {
    return normalizeZonereRaw(raw);
  }
}
