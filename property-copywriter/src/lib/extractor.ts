import { chromium } from "playwright";
import { ZonereAdapter } from "./adapters/zonere";
import { isSafeBrowserRequest, assertPublicHostname } from "./network-security";
import { enrichPropertyWithOpenAI } from "./openai-extractor";
import { propertySchema, type PropertyData } from "./schemas";
import { validatePropertyUrl } from "./url-security";

const adapters = [new ZonereAdapter()];

export async function analyzeProperty(value: string): Promise<PropertyData> {
  const url = validatePropertyUrl(value);
  await assertPublicHostname(url.hostname);
  const adapter = adapters.find((candidate) => candidate.supports(url));
  if (!adapter) throw new Error("Nu există un adaptor pentru această sursă.");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 PropertyAnalyzer/1.0",
  });
  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const safe = await isSafeBrowserRequest(request.url());
      if (!safe || ["media", "font"].includes(request.resourceType())) await route.abort();
      else await route.continue();
    });
    const raw = await adapter.extract(url, context);
    const property = await enrichPropertyWithOpenAI(raw, adapter.normalize(raw));
    if (!property.title && !property.originalDescription && Object.keys(property.additionalDetails).length === 0) {
      throw new Error("Pagina a fost încărcată, dar nu conține suficiente date despre proprietate.");
    }
    return propertySchema.parse(property);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
