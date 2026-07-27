import { contactFooter } from "./description-format";
import type { DescriptionKind, Descriptions, GenerationOptions, PropertyData } from "./schemas";

function formatNumber(value: number): string {
  return value.toLocaleString("ro-RO", { maximumFractionDigits: 2 });
}

function details(property: PropertyData): string {
  return [
    property.rooms !== null ? `${property.rooms} camere` : null,
    property.usableAreaSqm !== null ? `${formatNumber(property.usableAreaSqm)} mp utili` : null,
    property.floor ? `etaj ${property.floor}` : null,
    property.price !== null ? `${formatNumber(property.price)} ${property.currency ?? ""}`.trim() : null,
  ].filter(Boolean).join(", ");
}

function classicDescriptions(property: PropertyData, options: GenerationOptions): Descriptions {
  const name = property.title ?? ([property.propertyType, property.city, property.area].filter(Boolean).join(" – ") || "Proprietate");
  const facts = details(property);
  const location = [property.city, property.area].filter(Boolean).join(", ");
  const features = [...property.features, ...property.amenities].slice(0, 4).join(", ");
  const suffix = options.communicationType === "rent" ? "Disponibilă pentru închiriere." : "Disponibilă pentru vânzare.";
  return {
    commercial: {
      title: `${name} — prezentare completă`,
      description: `${name}${location ? `, în ${location}` : ""}. ${facts ? `Date principale: ${facts}. ` : ""}${features ? `Dotări confirmate: ${features}. ` : ""}${suffix}`,
    },
    emotional: {
      title: "Un spațiu potrivit ritmului tău",
      description: `${location ? `În ${location}, ` : ""}această proprietate propune un spațiu ușor de adaptat vieții de zi cu zi. ${facts ? `Configurația include ${facts}. ` : ""}${features ? `Experiența este completată de ${features}. ` : ""}${suffix}`,
    },
    premium: {
      title: `${name} — detalii care contează`,
      description: `O proprietate prezentată prin argumentele sale concrete. ${facts ? `${facts}. ` : ""}${location ? `Amplasare: ${location}. ` : ""}${features ? `Dintre elementele distinctive: ${features}. ` : ""}${suffix}`,
    },
  };
}

function detailLines(property: PropertyData, options: GenerationOptions): string[] {
  const emoji = options.useEmojis;
  const configuration = [
    property.rooms !== null ? `${formatNumber(property.rooms)} camere` : null,
    property.layout,
  ].filter(Boolean).join(", ");
  const areas = [
    property.usableAreaSqm !== null ? `${formatNumber(property.usableAreaSqm)} mp utili` : null,
    property.totalAreaSqm !== null ? `${formatNumber(property.totalAreaSqm)} mp construiți` : null,
  ].filter(Boolean).join(" / ");
  const location = [property.address, property.area, property.city].filter(Boolean).join(", ");
  const featureLimit = options.length === "short" ? 2 : options.length === "long" ? 6 : 4;
  const features = [...property.features, ...property.amenities].slice(0, featureLimit).join(", ");
  const bullet = (icon: string, label: string, value: string | null) =>
    value ? `${emoji ? `${icon} ` : "• "}${label}: ${value}` : null;

  return [
    bullet("📍", "Localizare", location || null),
    bullet("🏠", "Compartimentare", configuration || null),
    bullet("📐", "Suprafață", areas || null),
    bullet("🏢", "Etaj", property.floor),
    bullet("💶", "Preț", property.price !== null
      ? `${formatNumber(property.price)} ${property.currency ?? ""}`.trim()
      : null),
    bullet("✨", "Dotări", features || null),
  ].filter((line): line is string => Boolean(line));
}

function structuredDescriptions(property: PropertyData, options: GenerationOptions): Descriptions {
  const name = property.title ?? ([property.propertyType, property.area, property.city].filter(Boolean).join(" în ") || "Proprietate disponibilă");
  const prefix = (emoji: string) => options.useEmojis ? `${emoji} ` : "";
  const transaction = options.communicationType === "rent" ? "închiriere" : "vânzare";
  const sectionTitle = `${prefix("📌")}DETALII ESENȚIALE`;
  const lines = detailLines(property, options).join("\n");
  const footer = contactFooter(options);
  const description = (intro: string) => `${intro}\n\n${sectionTitle}\n${lines}\n\n${footer}`;

  return {
    commercial: {
      title: `${prefix("🏡")}${name}`.slice(0, 180),
      description: description(`Informațiile importante, într-un format clar și rapid de parcurs. Proprietatea este disponibilă pentru ${transaction}.`),
    },
    emotional: {
      title: `${prefix("✨")}Un spațiu pregătit pentru următorul tău capitol`.slice(0, 180),
      description: description(`Descoperă o proprietate cu o configurație practică, prezentată prin avantajele sale reale și ușor de verificat.`),
    },
    premium: {
      title: `${prefix("🔑")}${name} — detaliile care contează`.slice(0, 180),
      description: description(`O prezentare atent structurată, concentrată pe caracteristicile confirmate ale proprietății și pe informațiile relevante pentru o decizie.`),
    },
  };
}

export function generateDemoDescriptions(property: PropertyData, options: GenerationOptions): Descriptions {
  return options.format === "social-structured"
    ? structuredDescriptions(property, options)
    : classicDescriptions(property, options);
}

export function replaceDemoVariant(
  existing: Descriptions,
  property: PropertyData,
  options: GenerationOptions,
  variant: DescriptionKind,
): Descriptions {
  const regenerated = generateDemoDescriptions(property, options);
  const marker = options.format === "social-structured" ? "\n\nVariantă regenerată." : " Variantă regenerată.";
  return { ...existing, [variant]: { ...regenerated[variant], description: regenerated[variant].description + marker } };
}
