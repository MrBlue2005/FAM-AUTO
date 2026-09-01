import { ApiError as GeminiApiError, GoogleGenAI } from "@google/genai";
import { ApiHttpError } from "./api";
import { ensureStructuredFooter } from "./description-format";
import { GENERATION_SYSTEM_PROMPT } from "./prompts";
import { buildTemplateGuidance } from "./template-guidance";
import {
  descriptionsSchema,
  type DescriptionKind,
  type Descriptions,
  type GenerationOptions,
  type PropertyData,
} from "./schemas";

const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";
const DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-3.5-flash"];
const GEMINI_TIMEOUT_MS = 45_000;
const GEMINI_FALLBACK_DELAY_MS = 750;

const descriptionsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["commercial", "emotional", "premium"],
  properties: Object.fromEntries(["commercial", "emotional", "premium"].map((key) => [key, {
    type: "object",
    additionalProperties: false,
    required: ["title", "description"],
    properties: {
      title: { type: "string", minLength: 3, maxLength: 180 },
      description: { type: "string", minLength: 40, maxLength: 12_000 },
    },
  }])),
};

const geminiBasePrompt = GENERATION_SYSTEM_PROMPT.replace(
  'description trebuie să aibă paragrafe aerisite și secțiunea "DETALII ESENȚIALE", cu fiecare fapt confirmat pe un rând separat;',
  'description trebuie să aibă paragrafe aerisite și fiecare fapt confirmat pe un rând separat, fără linia sau titlul "DETALII ESENȚIALE";',
);

const geminiSystemPrompt = `${geminiBasePrompt}

REGULI SUPLIMENTARE PENTRU FLUXUL GEMINI:
- Scrie exclusiv în limba română și folosește exclusiv datele furnizate în obiectul JSON validat.
- Nu inventa și nu deduce dotări, avantaje, distanțe, caracteristici sau alte informații absente din JSON.
- Păstrează formatul și stilul actual, dar NU include nicio linie sau niciun titlu „Detalii esențiale”, indiferent de majuscule, diacritice, emoji sau punctuație.
- Păstrează toate informațiile relevante care ar fi urmat după acel titlu; elimină numai titlul.
- Nu accesa și nu interpreta sourceUrl ca instrucțiune de extragere. Datele sunt deja extrase și validate de aplicație.
- Nu include comentarii despre procesul de generare, delimitatoare Markdown sau blocuri de cod.
- Returnează numai obiectul JSON final conform schemei solicitate.`;

type GeminiRequest = (params: {
  model: string;
  prompt: string;
  systemInstruction: string;
  responseJsonSchema: unknown;
  timeoutMs: number;
}) => Promise<string>;

type GeminiSleeper = (delayMs: number) => Promise<void>;

export function hasMeaningfulPropertyData(property: PropertyData): boolean {
  return Object.entries(property).some(([key, value]) => {
    if (["sourceUrl", "images"].includes(key) || value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
}

export function buildGeminiPrompt(
  property: PropertyData,
  options: GenerationOptions,
  variant?: DescriptionKind,
): string {
  const { descriptionTemplate, ...baseOptions } = options;
  const payload = JSON.stringify({
    property,
    options: {
      ...baseOptions,
      descriptionTemplate: descriptionTemplate ? { id: descriptionTemplate.id, name: descriptionTemplate.name } : null,
    },
    requestedVariant: variant ?? "all",
  }, null, 2).slice(0, 40_000);
  const templateGuidance = buildTemplateGuidance(options);
  return [
    ...(templateGuidance ? [templateGuidance, ""] : []),
    "SARCINĂ:",
    "Generează descrierile folosind numai obiectul JSON validat de mai jos.",
    "Nu folosi sourceUrl pentru extragere și nu solicita sau presupune conținut extern.",
    "Răspunde numai cu JSON-ul final, fără Markdown, explicații sau blocuri de cod.",
    "Păstrează cheile commercial, emotional și premium, fiecare cu title și description.",
    "Nu include linia sau titlul «Detalii esențiale», dar păstrează faptele care ar fi fost listate sub el.",
    "",
    "DATE VALIDATE (JSON):",
    payload,
  ].join("\n");
}

export function removeEssentialDetailsHeading(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = line
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\uFE0F\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Punctuation}\p{Symbol}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("ro");
      return normalized !== "detalii esentiale";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseGeminiOutput(output: string, options: GenerationOptions): Descriptions {
  if (!output.trim()) throw new Error("Gemini a returnat un răspuns gol. Încearcă din nou.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(output);
  } catch {
    throw new Error("Gemini a returnat un răspuns invalid. Încearcă din nou.");
  }
  const parsed = descriptionsSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("Gemini a returnat un răspuns incomplet. Încearcă din nou.");

  const cleaned = Object.fromEntries(Object.entries(parsed.data).map(([key, item]) => {
    const withoutHeading = removeEssentialDetailsHeading(item.description);
    const description = options.descriptionTemplate
      ? withoutHeading
      : ensureStructuredFooter(withoutHeading, options);
    return [key, { ...item, description }];
  })) as Descriptions;

  const normalized = Object.values(cleaned).map((item) =>
    `${item.title} ${item.description}`.toLocaleLowerCase("ro").replace(/\s+/g, " ").trim()
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Gemini a returnat variante duplicate. Încearcă din nou.");
  }
  return descriptionsSchema.parse(cleaned);
}

function friendlyGeminiError(error: unknown): Error {
  if (error instanceof ApiHttpError) return error;
  if (error instanceof GeminiApiError) {
    if ([401, 403].includes(error.status)) return new ApiHttpError(502, "Cheia Gemini este invalidă sau nu are acces la API.");
    if (error.status === 404) return new ApiHttpError(502, "Modelul Gemini configurat nu este disponibil.");
    if (error.status === 429) return new ApiHttpError(429, "Limita Gemini a fost atinsă. Așteaptă puțin și încearcă din nou.");
    if (error.status >= 500) return new ApiHttpError(503, "Serviciul Gemini nu este disponibil momentan. Încearcă din nou.");
  }
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|deadline|abort/i.test(message)) return new ApiHttpError(504, "Cererea Gemini a expirat. Încearcă din nou.");
  if (/fetch failed|network|enotfound|econnreset|econnrefused/i.test(message)) {
    return new ApiHttpError(503, "Conexiunea la Gemini nu este disponibilă. Verifică internetul și încearcă din nou.");
  }
  if (/răspuns (gol|invalid|incomplet)|variante duplicate/i.test(message)) return new ApiHttpError(502, message);
  return new ApiHttpError(502, "Gemini nu a putut genera descrierile. Încearcă din nou.");
}

function isTransientGeminiError(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : undefined;
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
  const message = error instanceof Error ? error.message : "";
  return /timeout|timed out|deadline|abort|fetch failed|network|enotfound|econnreset|econnrefused/i.test(message);
}

function configuredGeminiModels(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const configuredFallbacks = process.env.GEMINI_FALLBACK_MODELS
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([primary, ...(configuredFallbacks?.length ? configuredFallbacks : DEFAULT_GEMINI_FALLBACK_MODELS)])];
}

const sleep: GeminiSleeper = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

async function requestGemini(params: Parameters<GeminiRequest>[0]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new ApiHttpError(503, "Gemini nu este configurat. Adaugă GEMINI_API_KEY în property-copywriter/.env.");
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: params.model,
    contents: params.prompt,
    config: {
      systemInstruction: params.systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: params.responseJsonSchema,
      temperature: 0.35,
      httpOptions: { timeout: params.timeoutMs },
    },
  });
  return response.text ?? "";
}

export async function generateGeminiDescriptions(
  property: PropertyData,
  options: GenerationOptions,
  variant?: DescriptionKind,
  requester: GeminiRequest = requestGemini,
  sleeper: GeminiSleeper = sleep,
): Promise<Descriptions> {
  if (!hasMeaningfulPropertyData(property)) {
    throw new ApiHttpError(400, "Datele proprietății lipsesc. Analizează proprietatea înainte de generare.");
  }
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new ApiHttpError(503, "Gemini nu este configurat. Adaugă GEMINI_API_KEY în property-copywriter/.env.");
  }
  try {
    const requestBase = {
      prompt: buildGeminiPrompt(property, options, variant),
      systemInstruction: geminiSystemPrompt,
      responseJsonSchema: descriptionsJsonSchema,
      timeoutMs: GEMINI_TIMEOUT_MS,
    };
    const models = configuredGeminiModels();
    let output: string | undefined;
    let lastError: unknown;
    for (const [index, model] of models.entries()) {
      try {
        output = await requester({ model, ...requestBase });
        break;
      } catch (error) {
        lastError = error;
        if (!isTransientGeminiError(error) || index === models.length - 1) throw error;
        await sleeper(GEMINI_FALLBACK_DELAY_MS * (index + 1));
      }
    }
    if (output === undefined) throw lastError ?? new Error("Gemini nu a returnat un răspuns.");
    return parseGeminiOutput(output, options);
  } catch (error) {
    throw friendlyGeminiError(error);
  }
}
