import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseZonereHtml } from "@/lib/adapters/html-fixture-parser";
import { normalizeZonereRaw } from "@/lib/adapters/zonere";
import { generateDemoDescriptions } from "@/lib/demo-generator";
import { buildManualChatGptPrompt, parseManualChatGptResponse } from "@/lib/manual-chatgpt";
import { emptyProperty, normalizeCurrency, normalizeNumber } from "@/lib/normalization";
import { descriptionsSchema, generationOptionsSchema, propertySchema } from "@/lib/schemas";
import { buildTemplateGuidance } from "@/lib/template-guidance";
import { validatePropertyUrl } from "@/lib/url-security";

describe("securitatea URL", () => {
  it("acceptă numai HTTPS pe domeniul Zonere", () => {
    expect(validatePropertyUrl("https://zonere.ro/oferta/123").hostname).toBe("zonere.ro");
    expect(() => validatePropertyUrl("http://zonere.ro/oferta/123")).toThrow(/HTTPS/);
    expect(() => validatePropertyUrl("https://example.com/oferta")).toThrow(/zonere/);
  });
  it.each(["https://localhost/x", "https://127.0.0.1/x", "https://192.168.1.2/x", "file:///etc/passwd"])(
    "respinge adresa privată sau protocolul %s",
    (url) => expect(() => validatePropertyUrl(url)).toThrow(),
  );
});

describe("normalizare și scheme", () => {
  it("normalizează prețuri, suprafețe și monede", () => {
    expect(normalizeNumber("245.000 EUR")).toBe(245000);
    expect(normalizeNumber("82,5 mp")).toBe(82.5);
    expect(normalizeCurrency("1.200 lei")).toBe("RON");
    expect(normalizeNumber("necunoscut")).toBeNull();
  });
  it("păstrează null pentru valori lipsă și respinge numere invalide", () => {
    expect(propertySchema.parse(emptyProperty("https://zonere.ro/test")).rooms).toBeNull();
    expect(() => propertySchema.parse({ ...emptyProperty("https://zonere.ro/test"), price: -1 })).toThrow();
  });
});

describe("adaptorul Zonere", () => {
  it("parsează fixture-ul local fără accesarea site-ului", () => {
    const fixture = readFileSync(resolve(process.cwd(), "tests/fixtures/zonere-property.html"), "utf8");
    const sourceUrl = "https://www.zonere.ro/proprietati/inchirieri-apartamente/bucuresti/eroii-revolutiei/anunt-test";
    const property = normalizeZonereRaw(parseZonereHtml(fixture, sourceUrl));
    expect(property.title).toContain("Scarlat Otulescu");
    expect(property.price).toBe(500);
    expect(property.usableAreaSqm).toBe(47);
    expect(property.totalAreaSqm).toBe(54);
    expect(property.rooms).toBe(2);
    expect(property.bathrooms).toBe(1);
    expect(property.floor).toBe("Etaj 4 / P+4");
    expect(property.totalFloors).toBe(4);
    expect(property.propertyType).toBe("Apartament");
    expect(property.city).toBe("București");
    expect(property.area).toBe("Eroii Revolutiei");
    expect(property.address).toContain("Scarlat Otulescu nr.4");
    expect(property.originalDescription).not.toContain("Iuliu Barasch");
    expect(property.transactionType).toBe("rent");
  });
});

describe("interfața Zonere nouă", () => {
  it("extrage descrierea și perechile de detalii", () => {
    const html = `
      <h1>Casă premium de vânzare în Adunații Copăceni</h1>
      <p>289.900 €</p>
      <h2>Despre Proprietate</h2><p>Descrierea completă a proprietății premium.</p>
      <h2>Lifestyle în zonă</h2>
      <div>Tip proprietate</div><div>Casa / Vila</div>
      <div>Tip tranzacție</div><div>De Vânzare</div>
      <div>Suprafață utilă</div><div>326 m²</div>
      <div>Suprafață construită</div><div>390 m²</div>
      <div>Suprafață teren</div><div>492 m²</div>
      <div>Nr. camere</div><div>6</div>
      <div>Nr. băi</div><div>2</div>
      <div>An construcție</div><div>2020</div>`;
    const property = normalizeZonereRaw(parseZonereHtml(html, "https://www.zonere.ro/casa-premium-de-vanzare"));
    expect(property.originalDescription).toContain("Descrierea completă");
    expect(property.price).toBe(289900);
    expect(property.propertyType).toBe("Casa / Vila");
    expect(property.transactionType).toBe("sale");
    expect(property.usableAreaSqm).toBe(326);
    expect(property.totalAreaSqm).toBe(390);
    expect(property.landAreaSqm).toBe(492);
    expect(property.rooms).toBe(6);
    expect(property.bathrooms).toBe(2);
    expect(property.constructionYear).toBe(2020);
  });
});

describe("generarea structurată", () => {
  const property = {
    ...emptyProperty("https://zonere.ro/oferta/test"), title: "Apartament 3 camere", rooms: 3,
    usableAreaSqm: 82.5, price: 245000, currency: "EUR", city: "București",
  };
  const options = {
    length: "medium", platform: "real-estate-site", communicationType: "sale", targetAudience: null,
    format: "classic", useEmojis: true, contactPhone: "", shortLink: "", descriptionTemplate: null,
  } as const;

  it("produce trei variante distincte și JSON valid", () => {
    const result = generateDemoDescriptions(property, options);
    expect(descriptionsSchema.parse(result)).toEqual(result);
    expect(new Set(Object.values(result).map((item) => item.description)).size).toBe(3);
  });
  it("nu modifică valorile numerice confirmate", () => {
    const result = generateDemoDescriptions(property, options);
    for (const item of Object.values(result)) {
      expect(item.description).toContain("3 camere");
      expect(item.description).toContain("82,5 mp");
      expect(item.description).toContain("245.000 EUR");
    }
  });
  it("structurează varianta socială cu emoji, CTA, telefon și shortlink", () => {
    const social = generateDemoDescriptions(property, {
      ...options,
      format: "social-structured",
      contactPhone: "+40 712 345 678",
      shortLink: "https://rx.ai/apartament",
    });
    for (const item of Object.values(social)) {
      expect(item.title).toMatch(/^[🏡✨🔑]/u);
      expect(item.description).toContain("📌 DETALII ESENȚIALE");
      expect(item.description).toContain("📞 Sună pentru detalii");
      expect(item.description).toContain("+40 712 345 678");
      expect(item.description).toContain("🔗 Link proprietate: https://rx.ai/apartament");
      expect(item.description.indexOf("📞")).toBeLessThan(item.description.indexOf("🔗"));
    }
  });
  it("folosește marcaje editabile și elimină emojiurile la cerere", () => {
    const social = generateDemoDescriptions(property, {
      ...options, format: "social-structured", useEmojis: false,
    });
    expect(social.commercial.description).toContain("[NUMĂR DE TELEFON]");
    expect(social.commercial.description).toContain("Link proprietate: [SHORTLINK]");
    expect(social.commercial.title).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(social.commercial.description).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("modele de descrieri", () => {
  const model = {
    id: "model-facebook",
    name: "Facebook standard",
    content: "🏠 TITLU MODEL\n\n📍 Localizare: Exemplu\n📐 Suprafață: 99 mp\n\n📞 Sună acum",
    instructions: "Păstrează maximum cinci emoji-uri.",
  };
  const options = generationOptionsSchema.parse({
    length: "medium", platform: "facebook", communicationType: "sale", targetAudience: null,
    format: "social-structured", useEmojis: true, contactPhone: "", shortLink: "",
    descriptionTemplate: model,
  });

  it("trimite modelul complet și criteriile explicite de mulare", () => {
    const guidance = buildTemplateGuidance(options);
    expect(guidance).toContain(model.content);
    expect(guidance).toContain(model.instructions);
    expect(guidance).toContain("Reproduce cât mai fidel macrostructura");
    expect(guidance).toContain("omite-o complet");
    expect(guidance).toContain("informații relevante pentru care modelul nu oferă un loc explicit");
    expect(guidance).toContain("Nu copia din model nume, adresă, preț, suprafețe");
  });

  it("include aceleași criterii în promptul manual ChatGPT", () => {
    const property = { ...emptyProperty("https://zonere.ro/oferta/model"), title: "Apartament test" };
    const prompt = buildManualChatGptPrompt(property, options);
    expect(prompt).toContain("MODEL DE DESCRIERE SELECTAT");
    expect(prompt).toContain(model.content);
    expect(prompt).toContain("CRITERII OBLIGATORII DE MULARE PE MODEL");
  });

  it("păstrează compatibilitatea istoricului fără model", () => {
    const parsed = generationOptionsSchema.parse({
      length: "short", platform: "general", communicationType: "rent", targetAudience: null,
      format: "classic", useEmojis: false, contactPhone: "", shortLink: "",
    });
    expect(parsed.descriptionTemplate).toBeNull();
  });
});
describe("fluxul manual ChatGPT", () => {
  const property = {
    ...emptyProperty("https://zonere.ro/oferta/manual"), title: "Apartament 2 camere", rooms: 2,
    usableAreaSqm: 47, price: 500, currency: "EUR", city: "București",
    images: ["https://zonere.ro/media/test.jpg"],
  };
  const options = {
    length: "medium", platform: "facebook", communicationType: "rent", targetAudience: "couple",
    format: "social-structured", useEmojis: true, contactPhone: "0737000000", shortLink: "", descriptionTemplate: null,
  } as const;

  it("construiește un prompt complet fără imaginile inutile", () => {
    const prompt = buildManualChatGptPrompt(property, options);
    expect(prompt).toContain("SCHEMA EXACTĂ A RĂSPUNSULUI");
    expect(prompt).toContain("Apartament 2 camere");
    expect(prompt).toContain("0737000000");
    expect(prompt).not.toContain("https://zonere.ro/media/test.jpg");
  });

  it("importă și validează JSON inclus într-un bloc Markdown", () => {
    const generated = generateDemoDescriptions(property, options);
    const parsed = parseManualChatGptResponse(`Răspuns:\n\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``, options);
    expect(parsed).toEqual(generated);
  });

  it("completează footerul obligatoriu și respinge structurile invalide", () => {
    const withoutFooter = {
      commercial: { title: "Titlu comercial", description: "Descriere comercială suficient de lungă și bazată pe date validate." },
      emotional: { title: "Titlu emoțional", description: "Descriere emoțională suficient de lungă și bazată pe date validate." },
      premium: { title: "Titlu premium", description: "Descriere premium suficient de lungă și bazată pe date validate." },
    };
    const parsed = parseManualChatGptResponse(JSON.stringify(withoutFooter), options);
    expect(parsed.commercial.description).toContain("0737000000");
    expect(parsed.commercial.description).toContain("[SHORTLINK]");
    expect(() => parseManualChatGptResponse('{"commercial":{}}', options)).toThrow(/JSON-ul așteptat/);
  });
});
