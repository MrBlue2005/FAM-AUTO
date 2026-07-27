import type { GenerationOptions } from "./schemas";

export function contactValues(options: GenerationOptions): { phone: string; link: string } {
  return {
    phone: options.contactPhone || "[NUMĂR DE TELEFON]",
    link: options.shortLink || "[SHORTLINK]",
  };
}

export function contactFooter(options: GenerationOptions): string {
  const { phone, link } = contactValues(options);
  const phonePrefix = options.useEmojis ? "📞 " : "";
  const linkPrefix = options.useEmojis ? "🔗 " : "";
  return [
    `${phonePrefix}Sună pentru detalii și programarea unei vizionări: ${phone}`,
    `${linkPrefix}Link proprietate: ${link}`,
  ].join("\n");
}

export function ensureStructuredFooter(description: string, options: GenerationOptions): string {
  if (options.format !== "social-structured") return description;
  const { phone, link } = contactValues(options);
  if (description.includes(phone) && description.includes(link)) return description;
  return `${description.trim()}\n\n${contactFooter(options)}`;
}
