import type { RawPropertyData } from "./types";

function decode(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function parseZonereHtml(html: string, sourceUrl: string): RawPropertyData {
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((match) => { try { return [JSON.parse(match[1]) as unknown]; } catch { return []; } });
  const openGraph: Record<string, string> = {};
  for (const match of html.matchAll(/<meta[^>]+property=["'](og:[^"']+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi)) {
    openGraph[match[1]] = match[2];
  }
  const facts: Record<string, string> = {};
  for (const match of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    facts[decode(match[1])] = decode(match[2]);
  }
  for (const match of html.matchAll(/<li[^>]*>\s*<[^>]+>([\s\S]*?)<\/[^>]+>\s*<[^>]+>([\s\S]*?)<\/[^>]+>\s*<\/li>/gi)) {
    const label = decode(match[1]).replace(/:$/, "");
    if (label && label.length <= 50) facts[label] ??= decode(match[2]);
  }
  for (const match of html.matchAll(/<tr[^>]*>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<\/tr>/gi)) {
    const label = decode(match[1]).replace(/:$/, "");
    if (label && label.length <= 50) facts[label] ??= decode(match[2]);
  }
  const leafTexts = [...html.matchAll(/<(?:span|p|strong|b|div)[^>]*>\s*([^<>]+?)\s*<\/(?:span|p|strong|b|div)>/gi)]
    .map((match) => decode(match[1]))
    .filter((value) => value.length > 0 && value.length <= 120);
  const knownLabels = new Set([
    "tip proprietate", "tip tranzactie", "suprafata utila", "suprafata construita", "suprafata teren",
    "nr. camere", "nr. bai", "nr. balcoane", "nr. terase", "regim de inaltime", "an constructie",
    "stare", "orientare", "structura", "clasa energetica",
  ]);
  leafTexts.forEach((label, index) => {
    const normalized = decode(label).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const value = leafTexts[index + 1];
    if (knownLabels.has(normalized) && value) facts[label] ??= value;
  });
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const sectionDescription = html.match(/<h[1-6][^>]*>\s*(?:Descriere proprietate|Despre Proprietate)\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6][^>]*>\s*(?:Facilit(?:a|ă)ți proprietate|Dotări\s*&\s*Facilități|Lifestyle în zonă|Galerie Foto|Toate Caracteristicile)\s*<\/h[1-6]>|$)/i);
  const descriptionMatch = sectionDescription
    ?? html.match(/<(?:article|div)[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)>/i);
  const pageText = decode(html).slice(0, 30_000);
  const price = pageText.match(/(\d[\d\s.,]*)\s*(EUR|RON|USD|€)(?:\s*\([^)]*\))?/i);
  if (price) facts.Preț ??= `${price[1]} ${price[2]}`;
  return {
    sourceUrl,
    title: titleMatch ? decode(titleMatch[1]) : null,
    description: descriptionMatch ? decode(descriptionMatch[1]) : null,
    jsonLd, openGraph, facts, images: [], pageText,
  };
}
