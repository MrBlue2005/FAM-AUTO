"use client";

import type { PropertyData } from "@/lib/schemas";

type Props = { value: PropertyData; onChange: (value: PropertyData) => void };
type TextKey = "title" | "propertyType" | "city" | "area" | "address" | "currency" | "floor" | "layout";
type NumberKey = "price" | "rooms" | "bedrooms" | "bathrooms" | "usableAreaSqm" | "totalAreaSqm" |
  "landAreaSqm" | "terraceAreaSqm" | "totalFloors" | "constructionYear" | "parkingSpaces" | "storageUnits";

const texts: [TextKey, string][] = [
  ["title", "Titlu"], ["propertyType", "Tip proprietate"], ["city", "Oraș"], ["area", "Zonă"],
  ["address", "Adresă / reper"], ["currency", "Monedă"], ["floor", "Etaj"], ["layout", "Compartimentare"],
];
const numbers: [NumberKey, string][] = [
  ["price", "Preț"], ["rooms", "Camere"], ["bedrooms", "Dormitoare"], ["bathrooms", "Băi"],
  ["usableAreaSqm", "Suprafață utilă (mp)"], ["totalAreaSqm", "Suprafață totală (mp)"],
  ["landAreaSqm", "Teren (mp)"], ["terraceAreaSqm", "Terasă (mp)"], ["totalFloors", "Total etaje"],
  ["constructionYear", "An construcție"], ["parkingSpaces", "Locuri parcare"], ["storageUnits", "Boxe"],
];

function listValue(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function PropertyForm({ value, onChange }: Props) {
  const patch = (next: Partial<PropertyData>) => onChange({ ...value, ...next });
  return (
    <section className="card p-5 md:p-7">
      <div className="mb-6">
        <p className="eyebrow">Pasul 2</p>
        <h2 className="mt-2 text-2xl font-black">Verifică datele extrase</h2>
        <p className="muted mt-2 text-sm">Corectează sau completează informațiile înainte de generare. Câmpurile goale nu vor fi inventate.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {texts.map(([key, label]) => (
          <div className={`field ${key === "title" ? "md:col-span-2" : ""}`} key={key}>
            <label htmlFor={key}>{label}</label>
            <input id={key} className="control" value={value[key] ?? ""} onChange={(event) => patch({ [key]: event.target.value || null })} />
          </div>
        ))}
        {numbers.map(([key, label]) => (
          <div className="field" key={key}>
            <label htmlFor={key}>{label}</label>
            <input id={key} className="control" type="number" min="0" step="any" value={value[key] ?? ""}
              onChange={(event) => patch({ [key]: event.target.value === "" ? null : Number(event.target.value) })} />
          </div>
        ))}
        <div className="field">
          <label htmlFor="features">Dotări (separate prin virgulă)</label>
          <input id="features" className="control" value={value.features.join(", ")}
            onChange={(event) => patch({ features: listValue(event.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="amenities">Facilități (separate prin virgulă)</label>
          <input id="amenities" className="control" value={value.amenities.join(", ")}
            onChange={(event) => patch({ amenities: listValue(event.target.value) })} />
        </div>
        <div className="field md:col-span-2 lg:col-span-3">
          <label htmlFor="description">Descriere originală</label>
          <textarea id="description" className="control min-h-32 resize-y" value={value.originalDescription ?? ""}
            onChange={(event) => patch({ originalDescription: event.target.value || null })} />
        </div>
      </div>
    </section>
  );
}
