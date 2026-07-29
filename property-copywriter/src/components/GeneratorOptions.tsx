"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DescriptionTemplateSnapshot, GenerationOptions } from "@/lib/schemas";

type TemplateItem = DescriptionTemplateSnapshot & { isDefault: boolean };
type Props = {
  value: GenerationOptions;
  onChange: (value: GenerationOptions) => void;
  preferredTemplateId?: string | null;
};

const choices = {
  length: [["short", "Scurtă"], ["medium", "Medie"], ["long", "Lungă"]],
  platform: [["real-estate-site", "Site imobiliar"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["linkedin", "LinkedIn"], ["general", "General"]],
  communicationType: [["sale", "Vânzare"], ["rent", "Închiriere"]],
  targetAudience: [["", "Nespecificat"], ["family", "Familie"], ["couple", "Cuplu"], ["investor", "Investitor"], ["professional", "Profesionist"], ["premium", "Premium"], ["general", "General"]],
  format: [["classic", "Clasic"], ["social-structured", "Social structurat"]],
} as const;

function snapshot(template: TemplateItem): DescriptionTemplateSnapshot {
  return { id: template.id, name: template.name, content: template.content, instructions: template.instructions };
}

export function GeneratorOptions({ value, onChange, preferredTemplateId }: Props) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const initialized = useRef(false);
  const initialOptions = useRef(value);

  useEffect(() => {
    fetch("/api/templates").then(async (response) => {
      const body = await response.json() as { templates?: TemplateItem[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Modelele nu au putut fi încărcate.");
      const loaded = body.templates ?? [];
      setTemplates(loaded);
      if (initialized.current) return;
      initialized.current = true;
      const selected = loaded.find((item) => item.id === preferredTemplateId)
        ?? (!initialOptions.current.descriptionTemplate ? loaded.find((item) => item.isDefault) : undefined);
      if (selected) onChange({ ...initialOptions.current, descriptionTemplate: snapshot(selected) });
    }).catch((caught: unknown) => {
      initialized.current = true;
      setTemplateError(caught instanceof Error ? caught.message : "Modelele nu au putut fi încărcate.");
    });
  }, [onChange, preferredTemplateId]);

  const selectTemplate = (id: string) => {
    const selected = templates.find((template) => template.id === id);
    onChange({ ...value, descriptionTemplate: selected ? snapshot(selected) : null });
  };

  return (
    <section className="card p-5 md:p-7">
      <p className="eyebrow">Pasul 3</p>
      <h2 className="mt-2 text-2xl font-black">Alege direcția textelor</h2>

      <div className="template-selector mt-6 rounded-2xl p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="field flex-1">
            <label htmlFor="descriptionTemplate">Model de descriere</label>
            <select id="descriptionTemplate" className="control" value={value.descriptionTemplate?.id ?? ""}
              onChange={(event) => selectTemplate(event.target.value)}>
              <option value="">Fără model — generatorul decide structura</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}{template.isDefault ? " (implicit)" : ""}</option>
              ))}
            </select>
          </div>
          <Link className="button secondary self-start md:self-auto" href="/templates">Gestionează modelele</Link>
        </div>
        {value.descriptionTemplate ? (
          <div className="selected-template mt-3 text-sm leading-6">
            <strong>Model activ: {value.descriptionTemplate.name}</strong>
            <span> GPT primește exemplul complet și criteriile de mulare; secțiunile neaplicabile sunt omise.</span>
          </div>
        ) : (
          <p className="muted mt-3 text-xs leading-5">Fără model, generatorul folosește regulile generale și completează structura după proprietate.</p>
        )}
        {templateError && <p className="mt-3 text-xs text-red-300">{templateError}</p>}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(choices) as (keyof typeof choices)[]).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={key}>{{ length: "Lungime", platform: "Platformă", communicationType: "Comunicare", targetAudience: "Public țintă", format: "Format text" }[key]}</label>
            <select id={key} className="control" value={value[key] ?? ""}
              onChange={(event) => onChange({ ...value, [key]: event.target.value || null })}>
              {choices[key].map(([option, label]) => <option key={option} value={option}>{label}</option>)}
            </select>
          </div>
        ))}
      </div>
      {value.format === "social-structured" && (
        <div className="structured-options mt-5 rounded-2xl p-4 md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <label className="emoji-toggle flex min-h-11 items-center gap-3 rounded-xl px-4 text-sm font-bold">
              <input type="checkbox" className="h-4 w-4 accent-[#22c55e]" checked={value.useEmojis}
                onChange={(event) => onChange({ ...value, useEmojis: event.target.checked })} />
              Folosește emoji-uri
            </label>
            <div className="field flex-1">
              <label htmlFor="contactPhone">Număr de telefon pentru CTA</label>
              <input id="contactPhone" className="control" type="tel" placeholder="+40 7xx xxx xxx"
                value={value.contactPhone} onChange={(event) => onChange({ ...value, contactPhone: event.target.value })} />
            </div>
            <div className="field flex-[1.35]">
              <label htmlFor="shortLink">Shortlink pentru măsurarea KPI</label>
              <input id="shortLink" className="control" type="text" placeholder="https://short.link/anunt"
                value={value.shortLink} onChange={(event) => onChange({ ...value, shortLink: event.target.value })} />
            </div>
          </div>
          <p className="muted mt-3 text-xs leading-5">
            Fără model, câmpurile necompletate apar ca [NUMĂR DE TELEFON] și [SHORTLINK]. Cu model activ, GPT urmează poziția CTA-ului din exemplu și omite datele lipsă.
          </p>
        </div>
      )}
    </section>
  );
}