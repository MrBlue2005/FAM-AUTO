"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RecordItem = {
  id: string; sourceUrl: string; title: string | null; descriptions: Record<string, { title: string; description: string }>;
  updatedAt: string;
};

export function HistoryList() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => fetch("/api/history").then(async (response) => {
    const body = await response.json() as { records?: RecordItem[]; error?: string };
    if (!response.ok) throw new Error(body.error);
    setRecords(body.records ?? []);
  }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Istoricul nu poate fi încărcat."));
  useEffect(() => { void load(); }, []);

  const remove = async (id: string) => {
    if (!window.confirm("Ștergi definitiv această intrare din istoric?")) return;
    const response = await fetch(`/api/history/${id}`, {
      method: "DELETE",
      headers: { "x-rx-csrf": "1" },
    });
    if (response.ok) setRecords((items) => items.filter((item) => item.id !== id));
    else setError("Intrarea nu a putut fi ștearsă.");
  };
  const copy = async (record: RecordItem) => {
    await navigator.clipboard.writeText(Object.values(record.descriptions).map((item) => `${item.title}\n${item.description}`).join("\n\n---\n\n"));
  };
  if (error) return <div className="notice error">{error}</div>;
  if (!records.length) return <div className="card muted p-8">Nu există încă proprietăți salvate. Generează primul set de descrieri.</div>;
  return <div className="grid gap-4">
    {records.map((record) => <article className="card flex flex-col gap-5 p-5 md:flex-row md:items-center" key={record.id}>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-black">{record.title || "Proprietate fără titlu"}</h2>
        <p className="muted mt-1 truncate text-sm">{record.sourceUrl}</p>
        <p className="muted mt-2 text-xs">Actualizat {new Date(record.updatedAt).toLocaleString("ro-RO")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link className="button" href={`/?id=${record.id}`}>Deschide / regenerează</Link>
        <button className="button ghost" onClick={() => copy(record)}>Copiază textele</button>
        <button className="button danger" onClick={() => remove(record.id)}>Șterge</button>
      </div>
    </article>)}
  </div>;
}
