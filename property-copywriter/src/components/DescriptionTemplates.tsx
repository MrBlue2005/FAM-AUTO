"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TemplateItem = {
  id: string;
  name: string;
  content: string;
  instructions: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type TemplateForm = Pick<TemplateItem, "name" | "content" | "instructions" | "isDefault">;
const emptyForm: TemplateForm = { name: "", content: "", instructions: "", isDefault: false };

async function templateRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== "GET") headers.set("x-rx-csrf", "1");
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Cererea nu a putut fi procesată.");
  return body;
}

export function DescriptionTemplates() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await templateRequest<{ templates: TemplateItem[] }>("/api/templates");
      setTemplates(result.templates);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Modelele nu au putut fi încărcate.");
    }
  };

  useEffect(() => {
    let active = true;
    void templateRequest<{ templates: TemplateItem[] }>("/api/templates")
      .then((result) => { if (active) setTemplates(result.templates); })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Modelele nu au putut fi încărcate.");
      });
    return () => { active = false; };
  }, []);

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const edit = (template: TemplateItem) => {
    setEditingId(template.id);
    setForm({
      name: template.name,
      content: template.content,
      instructions: template.instructions,
      isDefault: template.isDefault,
    });
    setError(null);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await templateRequest(editingId ? `/api/templates/${editingId}` : "/api/templates", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      setMessage(editingId ? "Modelul a fost actualizat." : "Modelul a fost salvat.");
      reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Modelul nu a putut fi salvat.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (template: TemplateItem) => {
    if (!window.confirm(`Ștergi modelul „${template.name}”? Istoricul generat cu el va păstra copia folosită.`)) return;
    setError(null); setMessage(null);
    try {
      await templateRequest(`/api/templates/${template.id}`, { method: "DELETE" });
      if (editingId === template.id) reset();
      setMessage("Modelul a fost șters.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Modelul nu a putut fi șters.");
    }
  };

  return (
    <div className="templates-layout grid gap-6 xl:grid-cols-[.78fr_1.22fr]">
      <section className="card template-editor self-start p-5 md:p-7">
        <p className="eyebrow">{editingId ? "Editare model" : "Model nou"}</p>
        <h2 className="mt-2 text-2xl font-black">{editingId ? "Actualizează structura" : "Adaugă un exemplu standard"}</h2>
        <p className="muted mt-3 text-sm leading-6">
          Lipește o descriere completă. Generatorul va urmări ordinea, spațierea, emoji-urile, titlurile și tipul de informații, fără să copieze date care nu apar în proprietatea curentă.
        </p>

        <div className="field mt-6">
          <label htmlFor="templateName">Numele modelului</label>
          <input id="templateName" className="control" maxLength={100} placeholder="Ex: Facebook apartamente premium"
            value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </div>

        <div className="field mt-4">
          <label htmlFor="templateContent">Exemplul complet de descriere</label>
          <textarea id="templateContent" className="control min-h-96 resize-y font-mono text-sm leading-6"
            maxLength={20000} placeholder="Lipește aici modelul, exact cu emoji-uri, rânduri și secțiuni..."
            value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
          <small className="muted text-right">{form.content.length.toLocaleString("ro-RO")} / 20.000</small>
        </div>

        <div className="field mt-4">
          <label htmlFor="templateInstructions">Instrucțiuni suplimentare (opțional)</label>
          <textarea id="templateInstructions" className="control min-h-28 resize-y" maxLength={4000}
            placeholder="Ex: ton direct, maximum 5 emoji-uri, CTA scurt..."
            value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} />
        </div>

        <label className="emoji-toggle mt-4 flex min-h-11 items-center gap-3 rounded-xl px-4 text-sm font-bold">
          <input type="checkbox" className="h-4 w-4 accent-[#22c55e]" checked={form.isDefault}
            onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} />
          Folosește automat ca model implicit
        </label>

        {error && <div className="notice error mt-4" role="alert">{error}</div>}
        {message && <div className="notice mt-4">{message}</div>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {editingId && <button className="button ghost" type="button" onClick={reset}>Renunță</button>}
          <button className="button min-w-44" type="button" disabled={busy || form.name.trim().length < 2 || form.content.trim().length < 20} onClick={save}>
            {busy && <span className="spinner" />} {busy ? "Salvăm…" : editingId ? "Actualizează modelul" : "Salvează modelul"}
          </button>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Bibliotecă locală</p>
            <h2 className="mt-2 text-2xl font-black">Modelele tale</h2>
          </div>
          <span className="result-badge rounded-full px-3 py-1 text-xs font-black">{templates.length} modele</span>
        </div>

        {!templates.length ? (
          <div className="card muted p-8 text-center leading-7">Nu există încă modele. Adaugă prima descriere standard în formularul alăturat.</div>
        ) : (
          <div className="grid gap-4">
            {templates.map((template) => (
              <article className="card template-card p-5 md:p-6" key={template.id}>
                <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black">{template.name}</h3>
                      {template.isDefault && <span className="result-badge rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider">Implicit</span>}
                    </div>
                    <p className="muted mt-1 text-xs">Actualizat {new Date(template.updatedAt).toLocaleString("ro-RO")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link className="button secondary" href={`/?template=${template.id}`}>Folosește</Link>
                    <button className="button ghost" type="button" onClick={() => edit(template)}>Editează</button>
                    <button className="button danger" type="button" onClick={() => remove(template)}>Șterge</button>
                  </div>
                </header>
                {template.instructions && <p className="template-instructions mt-4 rounded-xl px-4 py-3 text-sm leading-6">{template.instructions}</p>}
                <pre className="template-preview mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl p-4 text-sm leading-6">{template.content}</pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}