import OpenAI from "openai";
import { generateDemoDescriptions } from "./demo-generator";
import { ensureStructuredFooter } from "./description-format";
import { GENERATION_SYSTEM_PROMPT } from "./prompts";
import {
  descriptionsSchema, type DescriptionKind, type Descriptions,
  type GenerationOptions, type PropertyData,
} from "./schemas";

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["commercial", "emotional", "premium"],
  properties: Object.fromEntries(["commercial", "emotional", "premium"].map((key) => [key, {
    type: "object", additionalProperties: false, required: ["title", "description"],
    properties: { title: { type: "string" }, description: { type: "string" } },
  }])),
};

function parseOutput(output: string, options: GenerationOptions): Descriptions {
  const parsed = descriptionsSchema.parse(JSON.parse(output) as unknown);
  const normalized = Object.values(parsed).map((item) =>
    `${item.title} ${item.description}`.toLocaleLowerCase("ro").replace(/\s+/g, " ").trim()
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Modelul a returnat variante duplicate.");
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [
    key, { ...item, description: ensureStructuredFooter(item.description, options) },
  ])) as Descriptions;
}

async function requestDescriptions(
  client: OpenAI,
  property: PropertyData,
  options: GenerationOptions,
  variant?: DescriptionKind,
  repairText?: string,
): Promise<string> {
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const payload = JSON.stringify({ property, options, requestedVariant: variant ?? "all" }).slice(0, 40_000);
  const response = await client.responses.create({
    model,
    instructions: GENERATION_SYSTEM_PROMPT,
    input: repairText
      ? `Repară răspunsul invalid de mai jos fără să adaugi informații. Date validate:\n${payload}\nRăspuns invalid:\n${repairText.slice(0, 20_000)}`
      : `Generează descrierile folosind numai aceste date validate:\n${payload}`,
    text: { format: { type: "json_schema", name: "property_descriptions", strict: true, schema: jsonSchema } },
  });
  return response.output_text;
}

export async function generateDescriptions(
  property: PropertyData,
  options: GenerationOptions,
  variant?: DescriptionKind,
): Promise<Descriptions> {
  if (process.env.DEMO_MODE === "true" || !process.env.OPENAI_API_KEY) {
    return generateDemoDescriptions(property, options);
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const first = await requestDescriptions(client, property, options, variant);
  try {
    return parseOutput(first, options);
  } catch {
    const repaired = await requestDescriptions(client, property, options, variant, first);
    try {
      return parseOutput(repaired, options);
    } catch {
      throw new Error("Modelul a returnat de două ori un răspuns invalid. Încearcă din nou.");
    }
  }
}
