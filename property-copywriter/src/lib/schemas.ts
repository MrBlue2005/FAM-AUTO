import { z } from "zod";

const nullableText = z.string().trim().max(4000).nullable();
const nullableNumber = z.number().finite().nonnegative().nullable();

export const propertySchema = z.object({
  sourceUrl: z.string().url().max(2048),
  title: nullableText,
  transactionType: z.enum(["sale", "rent"]).nullable(),
  propertyType: nullableText,
  city: nullableText,
  area: nullableText,
  address: nullableText,
  price: nullableNumber,
  currency: nullableText,
  rooms: nullableNumber,
  bedrooms: nullableNumber,
  bathrooms: nullableNumber,
  usableAreaSqm: nullableNumber,
  totalAreaSqm: nullableNumber,
  landAreaSqm: nullableNumber,
  terraceAreaSqm: nullableNumber,
  floor: nullableText,
  totalFloors: nullableNumber,
  constructionYear: z.number().int().min(1700).max(new Date().getFullYear() + 5).nullable(),
  layout: nullableText,
  parkingSpaces: nullableNumber,
  storageUnits: nullableNumber,
  features: z.array(z.string().trim().min(1).max(200)).max(100),
  amenities: z.array(z.string().trim().min(1).max(200)).max(100),
  originalDescription: z.string().trim().max(20_000).nullable(),
  images: z.array(z.string().url().max(2048)).max(30),
  additionalDetails: z.record(z.string(), z.string().max(500)).default({}),
});

export type PropertyData = z.infer<typeof propertySchema>;

export const descriptionTemplateSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(2).max(100),
  content: z.string().trim().min(20).max(20_000),
  instructions: z.string().trim().max(4_000).default(""),
});

export type DescriptionTemplateSnapshot = z.infer<typeof descriptionTemplateSnapshotSchema>;

export const descriptionTemplateInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  content: z.string().trim().min(20).max(20_000),
  instructions: z.string().trim().max(4_000).default(""),
  isDefault: z.boolean().default(false),
});

export type DescriptionTemplateInput = z.infer<typeof descriptionTemplateInputSchema>;
export const generationOptionsSchema = z.object({
  length: z.enum(["short", "medium", "long"]),
  platform: z.enum(["real-estate-site", "facebook", "instagram", "linkedin", "general"]),
  communicationType: z.enum(["sale", "rent"]),
  targetAudience: z.enum(["family", "couple", "investor", "professional", "premium", "general"]).nullable(),
  format: z.enum(["classic", "social-structured"]).default("classic"),
  useEmojis: z.boolean().default(true),
  contactPhone: z.string().trim().max(50).default(""),
  shortLink: z.string().trim().max(2048).default(""),
  descriptionTemplate: descriptionTemplateSnapshotSchema.nullable().default(null),
});

export type GenerationOptions = z.infer<typeof generationOptionsSchema>;

const descriptionSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(40).max(12_000),
});

export const descriptionsSchema = z.object({
  commercial: descriptionSchema,
  emotional: descriptionSchema,
  premium: descriptionSchema,
});

export type Descriptions = z.infer<typeof descriptionsSchema>;
export type DescriptionKind = keyof Descriptions;

export const analyzeRequestSchema = z.object({ url: z.string().trim().max(2048) });
export const generateRequestSchema = z.object({
  property: propertySchema,
  options: generationOptionsSchema,
  variant: z.enum(["commercial", "emotional", "premium"]).optional(),
  recordId: z.string().min(1).optional(),
});
export const saveRequestSchema = z.object({
  extractedData: propertySchema,
  correctedData: propertySchema,
  options: generationOptionsSchema,
  descriptions: descriptionsSchema,
  id: z.string().min(1).optional(),
});
