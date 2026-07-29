import type { BrowserContext } from "playwright";
import type { PropertyData } from "../schemas";

export type RawPropertyData = {
  sourceUrl: string;
  title: string | null;
  description: string | null;
  jsonLd: unknown[];
  openGraph: Record<string, string>;
  facts: Record<string, string>;
  images: string[];
  pageText: string;
};

export interface PropertySourceAdapter {
  supports(url: URL): boolean;
  extract(url: URL, context: BrowserContext): Promise<RawPropertyData>;
  normalize(raw: RawPropertyData): PropertyData;
}
