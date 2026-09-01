import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGeminiPrompt,
  generateGeminiDescriptions,
  hasMeaningfulPropertyData,
  parseGeminiOutput,
  removeEssentialDetailsHeading,
} from "@/lib/gemini-generator";
import { emptyProperty } from "@/lib/normalization";
import type { GenerationOptions } from "@/lib/schemas";

const property = {
  ...emptyProperty("https://zonere.ro/oferta/gemini"),
  title: "Apartament 2 camere",
  rooms: 2,
  usableAreaSqm: 47,
  price: 95_000,
  currency: "EUR",
  city: "București",
};

const options: GenerationOptions = {
  length: "medium",
  platform: "facebook",
  communicationType: "sale",
  targetAudience: "couple",
  format: "social-structured",
  useEmojis: true,
  contactPhone: "0737000000",
  shortLink: "https://zonere.ro/s/gemini",
  descriptionTemplate: null,
};

const response = {
  commercial: {
    title: "Apartament practic în București",
    description: "Prezentare comercială bazată pe informațiile confirmate.\n\n📌 DETALII ESENȚIALE:\n2 camere\n47 mp utili",
  },
  emotional: {
    title: "Un spațiu potrivit pentru doi",
    description: "Prezentare caldă, construită numai pe datele proprietății.\n\n**Detalii esentiale**\n2 camere\n47 mp utili",
  },
  premium: {
    title: "Configurație atent prezentată",
    description: "Prezentare rafinată și concretă, fără informații presupuse.\n\nDETALII ESENȚIALE\nPreț: 95.000 EUR",
  },
};

afterEach(() => vi.unstubAllEnvs());

describe("integrarea Gemini", () => {
  it("trimite JSON-ul validat și toate regulile editoriale, fără instrucțiuni de scraping", () => {
    const prompt = buildGeminiPrompt(property, options);
    expect(prompt).toContain('"title": "Apartament 2 camere"');
    expect(prompt).toContain('"usableAreaSqm": 47');
    expect(prompt).toContain('"requestedVariant": "all"');
    expect(prompt).toContain("folosind numai obiectul JSON validat");
    expect(prompt).toContain("Nu folosi sourceUrl pentru extragere");
    expect(prompt).toContain("Nu include linia sau titlul «Detalii esențiale»");
  });

  it("elimină numai titlul Detalii esențiale și păstrează informațiile de sub el", () => {
    const cleaned = removeEssentialDetailsHeading("Intro\n\n📌 DETALII ESENȚIALE:\n2 camere\n47 mp utili");
    expect(cleaned).not.toMatch(/detalii esențiale/i);
    expect(cleaned).toContain("2 camere");
    expect(cleaned).toContain("47 mp utili");
  });

  it("generează printr-un client mock, validează JSON-ul și completează zona existentă", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    const requester = vi.fn().mockResolvedValue(JSON.stringify(response));
    const generated = await generateGeminiDescriptions(property, options, undefined, requester);

    expect(requester).toHaveBeenCalledOnce();
    expect(requester.mock.calls[0][0]).toMatchObject({ model: "gemini-3.7-flash", timeoutMs: 45_000 });
    expect(requester.mock.calls[0][0].systemInstruction).not.toContain('secțiunea "DETALII ESENȚIALE"');
    for (const item of Object.values(generated)) {
      expect(item.description).not.toMatch(/detalii esențiale/i);
      expect(item.description).toContain("0737000000");
      expect(item.description).toContain("https://zonere.ro/s/gemini");
    }
    expect(generated.commercial.description).toContain("2 camere");
  });

  it("respinge datele goale înainte de apelarea API-ului", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    const requester = vi.fn();
    const empty = emptyProperty("https://zonere.ro/oferta/goala");
    expect(hasMeaningfulPropertyData(empty)).toBe(false);
    await expect(generateGeminiDescriptions(empty, options, undefined, requester)).rejects.toThrow(/Datele proprietății lipsesc/);
    expect(requester).not.toHaveBeenCalled();
  });

  it("tratează cheia lipsă, răspunsul gol și JSON-ul invalid fără apeluri reale", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(generateGeminiDescriptions(property, options, undefined, vi.fn())).rejects.toThrow(/nu este configurat/);
    expect(() => parseGeminiOutput("", options)).toThrow(/răspuns gol/);
    expect(() => parseGeminiOutput("nu este json", options)).toThrow(/răspuns invalid/);
  });
});
