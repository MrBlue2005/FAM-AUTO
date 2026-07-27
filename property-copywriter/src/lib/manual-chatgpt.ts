import { ensureStructuredFooter } from "./description-format";
import { GENERATION_SYSTEM_PROMPT } from "./prompts";
import { buildTemplateGuidance } from "./template-guidance";
import {
  descriptionsSchema,
  type Descriptions,
  type GenerationOptions,
  type PropertyData,
} from "./schemas";

const responseShape = {
  commercial: { title: "Hook comercial", description: "Descriere comercială completă" },
  emotional: { title: "Hook emoțional", description: "Descriere emoțională completă" },
  premium: { title: "Hook premium", description: "Descriere premium completă" },
};

export function buildManualChatGptPrompt(property: PropertyData, options: GenerationOptions): string {
  const promptProperty = { ...property, images: [] };
  const { descriptionTemplate, ...baseOptions } = options;
  const payload = JSON.stringify({
    property: promptProperty,
    options: {
      ...baseOptions,
      descriptionTemplate: descriptionTemplate ? { id: descriptionTemplate.id, name: descriptionTemplate.name } : null,
    },
  }, null, 2);
  const templateGuidance = buildTemplateGuidance(options);
  return [
    GENERATION_SYSTEM_PROMPT,
    ...(templateGuidance ? ["", templateGuidance] : []),
    "",
    "SARCINĂ:",
    "Generează toate cele trei variante pentru proprietatea și opțiunile validate de mai jos.",
    "Răspunde NUMAI cu obiectul JSON. Nu folosi Markdown, explicații sau blocuri de cod.",
    "Păstrează exact cheile commercial, emotional și premium, fiecare cu title și description.",
    "",
    "SCHEMA EXACTĂ A RĂSPUNSULUI:",
    JSON.stringify(responseShape, null, 2),
    "",
    "DATE VALIDATE:",
    payload,
  ].join("\n");
}

function jsonCandidate(value: string): string {
  const trimmed = value.trim().replace(/^\uFEFF/, "");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  return firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
}

export function parseManualChatGptResponse(value: string, options: GenerationOptions): Descriptions {
  if (!value.trim()) throw new Error("Lipește mai întâi răspunsul JSON primit din ChatGPT.");
  if (value.length > 50_000) throw new Error("Răspunsul este prea lung pentru import.");
  try {
    const parsed = descriptionsSchema.parse(JSON.parse(jsonCandidate(value)) as unknown);
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [
      key,
      { ...item, description: options.descriptionTemplate ? item.description : ensureStructuredFooter(item.description, options) },
    ])) as Descriptions;
  } catch (error) {
    if (error instanceof Error && /Lipește|prea lung/.test(error.message)) throw error;
    throw new Error("Răspunsul nu este JSON-ul așteptat. Copiază integral răspunsul ChatGPT și încearcă din nou.", { cause: error });
  }
}
