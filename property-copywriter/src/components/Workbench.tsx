"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GeneratorOptions } from "./GeneratorOptions";
import { ManualChatGptPanel } from "./ManualChatGptPanel";
import { PropertyForm } from "./PropertyForm";
import { ResultCards } from "./ResultCards";
import { buildManualChatGptPrompt, parseManualChatGptResponse } from "@/lib/manual-chatgpt";
import {
  descriptionsSchema, generationOptionsSchema, propertySchema,
  type DescriptionKind, type Descriptions, type GenerationOptions, type PropertyData,
} from "@/lib/schemas";

type HistoryRecord = {
  id: string; extractedData: unknown; correctedData: unknown; generationOptions: unknown; descriptions: unknown;
};
const defaults: GenerationOptions = {
  length: "medium", platform: "real-estate-site", communicationType: "sale", targetAudience: null,
  format: "social-structured", useEmojis: true, contactPhone: "", shortLink: "", descriptionTemplate: null,
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = String(init?.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) headers.set("x-rx-csrf", "1");
  const response = await fetch(url, { ...init, headers });
  const body = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || "Cererea nu a putut fi procesată.");
  return body;
}

export function Workbench({ demo }: { demo: boolean }) {
  const search = useSearchParams();
  const [url, setUrl] = useState("");
  const [extracted, setExtracted] = useState<PropertyData | null>(null);
  const [property, setProperty] = useState<PropertyData | null>(null);
  const [options, setOptions] = useState(defaults);
  const [descriptions, setDescriptions] = useState<Descriptions | null>(null);
  const [recordId, setRecordId] = useState<string | undefined>();
  const [busy, setBusy] = useState<"analyze" | DescriptionKind | "all" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPrompt, setManualPrompt] = useState("");
  const [manualResponse, setManualResponse] = useState("");
  const [manualInfo, setManualInfo] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  useEffect(() => {
    const id = search.get("id");
    if (!id) return;
    jsonRequest<{ record: HistoryRecord }>(`/api/history/${id}`).then(({ record }) => {
      const loadedProperty = propertySchema.parse(record.correctedData);
      setRecordId(record.id); setUrl(loadedProperty.sourceUrl);
      setExtracted(propertySchema.parse(record.extractedData)); setProperty(loadedProperty);
      setOptions(generationOptionsSchema.parse(record.generationOptions));
      setDescriptions(descriptionsSchema.parse(record.descriptions));
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Istoricul nu a putut fi încărcat."));
  }, [search]);

  const analyze = async () => {
    setBusy("analyze"); setError(null); setMessage(null); setDescriptions(null); setRecordId(undefined);
    setManualOpen(false); setManualResponse(""); setManualError(null); setManualInfo(null);
    try {
      const result = await jsonRequest<{ property: PropertyData }>("/api/analyze", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
      });
      const parsed = propertySchema.parse(result.property);
      setExtracted(parsed); setProperty(parsed);
      setOptions((current) => ({ ...current, communicationType: parsed.transactionType ?? current.communicationType }));
      setMessage("Datele au fost extrase. Verifică-le înainte de generare.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Analiza a eșuat."); }
    finally { setBusy(null); }
  };

  const persistDescriptions = async (next: Descriptions, successMessage: string) => {
    if (!property || !extracted) return;
    setDescriptions(next);
    const saved = await jsonRequest<{ record: { id: string } }>("/api/history", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: recordId, extractedData: extracted, correctedData: property, options, descriptions: next }),
    });
    setRecordId(saved.record.id);
    setMessage(successMessage);
  };

  const generate = async (variant?: DescriptionKind) => {
    if (!property || !extracted) return;
    if (demo && options.descriptionTemplate) {
      setError("Adaptarea după model necesită GPT. Folosește fluxul manual ChatGPT sau configurează cheia OpenAI API.");
      return;
    }
    setBusy(variant ?? "all"); setError(null); setMessage(null);
    try {
      const result = await jsonRequest<{ descriptions: Descriptions }>("/api/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ property, options, variant, recordId }),
      });
      const next = descriptionsSchema.parse(result.descriptions);
      const merged = variant && descriptions ? { ...descriptions, [variant]: next[variant] } : next;
      await persistDescriptions(merged, "Descrierile au fost generate și salvate în istoric.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Generarea a eșuat."); }
    finally { setBusy(null); }
  };

  const openManualChatGpt = async () => {
    if (!property) return;
    const prompt = buildManualChatGptPrompt(property, options);
    setManualPrompt(prompt);
    setManualOpen(true);
    setManualResponse("");
    setManualError(null);
    setManualInfo(null);
    window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(prompt);
      setManualInfo("Promptul a fost copiat. Lipește-l în ChatGPT, apoi copiază răspunsul JSON aici.");
    } catch {
      setManualInfo("ChatGPT a fost deschis. Copiază manual promptul din secțiunea „Vezi promptul pregătit”.");
    }
  };

  const copyManualPrompt = async () => {
    if (!property) return;
    const prompt = buildManualChatGptPrompt(property, options);
    setManualPrompt(prompt);
    setManualError(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setManualInfo("Promptul actualizat a fost copiat.");
    } catch {
      setManualError("Clipboard-ul nu este disponibil. Selectează promptul afișat și copiază-l manual.");
    }
  };

  const importManualResponse = async () => {
    if (!property || !extracted) return;
    setManualBusy(true); setManualError(null); setError(null); setMessage(null);
    try {
      const imported = parseManualChatGptResponse(manualResponse, options);
      await persistDescriptions(imported, "Textele din ChatGPT au fost importate și salvate în istoric.");
      setManualOpen(false);
      setManualResponse("");
    } catch (caught) {
      setManualError(caught instanceof Error ? caught.message : "Răspunsul ChatGPT nu a putut fi importat.");
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <main className="shell py-10 md:py-16">
      <section className="mb-8 grid gap-7 lg:grid-cols-[1fr_.62fr] lg:items-end">
        <div>
          <p className="eyebrow">RX CREATIVE TOOL</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black leading-[1.05] tracking-[-.04em] md:text-6xl">Aim for perfection</h1>
          <p className="muted mt-5 max-w-2xl text-lg leading-8">Transformă un link Zonere în variante comerciale, emoționale și premium, construite pe date validate și gata de publicat.</p>
        </div>
        <div className="card border-l-4 !border-l-[#22c55e] p-5 text-sm leading-6 text-[#aeb7b2]">
          <strong className="block text-white">{demo ? "Mod fără cheie API" : "Generare OpenAI API activă"}</strong>
          {demo ? "Poți genera în ChatGPT prin copiere și import sau poți folosi șabloanele demonstrative locale." : "Datele validate sunt trimise modelului configurat pe server; fluxul manual ChatGPT rămâne disponibil."}
        </div>
      </section>

      <section className="card mb-6 p-5 md:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Pasul 1</p>
            <h2 className="mt-2 text-2xl font-black">Analizează proprietatea</h2>
          </div>
          <div className="flex flex-wrap gap-2 self-start sm:justify-end">
            <a className="button secondary" href="https://zonere.ro/proprietati/"
              target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">🏘️</span> Proprietăți Zonere <span aria-hidden="true">↗</span>
            </a>
            <a className="button secondary" href="https://zonere.ro/short/"
              target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">🔗</span> Shortlink-uri Zonere <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 md:flex-row">
          <input aria-label="URL proprietate" className="control flex-1" type="url" placeholder="https://zonere.ro/proprietate/..."
            value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => event.key === "Enter" && analyze()} />
          <button className="button min-w-56" disabled={!url || busy !== null} onClick={analyze}>
            {busy === "analyze" && <span className="spinner" />} {busy === "analyze" ? "Analizăm pagina…" : "Analizează proprietatea"}
          </button>
        </div>
        {error && <div className="notice error mt-4" role="alert">{error} Verifică datele și încearcă din nou.</div>}
        {message && <div className="notice mt-4">{message}</div>}
      </section>

      {property && <div className="grid gap-6"><PropertyForm value={property} onChange={setProperty} /><GeneratorOptions value={options} onChange={setOptions} preferredTemplateId={search.get("template")} />
        {demo && options.descriptionTemplate && (
          <div className="notice">
            Modelul „{options.descriptionTemplate.name}” este inclus integral în prompt. Pentru adaptare inteligentă folosește butonul „Deschide ChatGPT + copiază promptul”; fallbackul local nu copiază date din exemplu.
          </div>
        )}        <div className="flex flex-wrap justify-end gap-3">
          <button className={demo ? "button secondary min-w-56" : "button min-w-56"} disabled={busy !== null || manualBusy || (demo && Boolean(options.descriptionTemplate))} onClick={() => generate()}>
            {busy === "all" && <span className="spinner" />} {demo && options.descriptionTemplate ? "Modelul necesită GPT" : demo ? "Generează local (demo)" : "Generează cu OpenAI API"}
          </button>
          <button className={demo ? "button min-w-72" : "button secondary min-w-72"} disabled={busy !== null || manualBusy} onClick={openManualChatGpt}>
            <span aria-hidden="true">✨</span> Deschide ChatGPT + copiază promptul
          </button>
        </div>
        {manualOpen && <ManualChatGptPanel
          prompt={manualPrompt}
          response={manualResponse}
          info={manualInfo}
          error={manualError}
          busy={manualBusy}
          onResponseChange={setManualResponse}
          onCopyPrompt={copyManualPrompt}
          onImport={importManualResponse}
          onClose={() => setManualOpen(false)}
        />}
        {descriptions && <ResultCards value={descriptions} busyVariant={busy === "analyze" ? null : busy} onRegenerate={generate} />}
      </div>}
    </main>
  );
}
