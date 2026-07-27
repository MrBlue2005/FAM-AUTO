"use client";

import type { GenerationOptions } from "@/lib/schemas";

type Props = { value: GenerationOptions; onChange: (value: GenerationOptions) => void };
const choices = {
  length: [["short", "Scurtă"], ["medium", "Medie"], ["long", "Lungă"]],
  platform: [["real-estate-site", "Site imobiliar"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["linkedin", "LinkedIn"], ["general", "General"]],
  communicationType: [["sale", "Vânzare"], ["rent", "Închiriere"]],
  targetAudience: [["", "Nespecificat"], ["family", "Familie"], ["couple", "Cuplu"], ["investor", "Investitor"], ["professional", "Profesionist"], ["premium", "Premium"], ["general", "General"]],
  format: [["classic", "Clasic"], ["social-structured", "Social structurat"]],
} as const;

export function GeneratorOptions({ value, onChange }: Props) {
  return (
    <section className="card p-5 md:p-7">
      <p className="eyebrow">Pasul 3</p>
      <h2 className="mt-2 text-2xl font-black">Alege direcția textelor</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
              Folosește emojiuri
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
            Câmpurile necompletate vor apărea în text ca [NUMĂR DE TELEFON] și [SHORTLINK], ca să le poți înlocui ulterior.
          </p>
        </div>
      )}
    </section>
  );
}
