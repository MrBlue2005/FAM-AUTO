"use client";

import { useState } from "react";
import type { DescriptionKind, Descriptions } from "@/lib/schemas";

type Props = {
  value: Descriptions;
  busyVariant: DescriptionKind | "all" | null;
  transferBusy: boolean;
  externalBusy?: boolean;
  onRegenerate: (variant?: DescriptionKind) => void;
  onTransfer: () => void;
};
const labels: Record<DescriptionKind, string> = { commercial: "Comercială", emotional: "Emoțională", premium: "Premium" };

function DescriptionPreview({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="description-preview mt-4 flex-1 space-y-4 text-[.94rem] leading-7">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter(Boolean);
        const isContact = lines.some((line) => /^(📞|Sună pentru|CONTACT)/i.test(line));
        return (
          <div className={isContact ? "description-contact rounded-xl p-3" : ""} key={`${blockIndex}-${block.slice(0, 18)}`}>
            {lines.map((line, lineIndex) => {
              const isHeading = /^(📌\s*)?DETALII ESENȚIALE$/i.test(line);
              const isLink = /^(🔗\s*)?Link proprietate:/i.test(line);
              const isPhone = /^(📞\s*)?Sună pentru/i.test(line);
              return (
                <p className={[
                  isHeading ? "description-heading mb-2 text-xs font-black tracking-[.12em]" : "",
                  isPhone ? "description-phone font-bold" : "",
                  isLink ? "description-link break-all text-sm font-bold" : "",
                  !isHeading && !isPhone && !isLink && lines.length > 1 ? "description-line py-1 last:border-0" : "",
                ].filter(Boolean).join(" ")} key={`${lineIndex}-${line.slice(0, 16)}`}>
                  {line}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function ResultCards({ value, busyVariant, transferBusy, externalBusy = false, onRegenerate, onTransfer }: Props) {
  const [copied, setCopied] = useState<DescriptionKind | null>(null);
  const copy = async (kind: DescriptionKind) => {
    const item = value[kind];
    await navigator.clipboard.writeText(`${item.title}\n\n${item.description}`);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  };
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">Rezultate</p><h2 className="mt-2 text-3xl font-black">Trei abordări distincte</h2></div>
        <div className="flex flex-wrap gap-2">
          <button className="button" disabled={busyVariant !== null || transferBusy || externalBusy} onClick={onTransfer}>
            {transferBusy && <span className="spinner" />}
            {transferBusy ? "Se transferă..." : "Trimite în RX PROPULSE"}
          </button>
          <button className="button secondary" disabled={busyVariant !== null || transferBusy || externalBusy} onClick={() => onRegenerate()}>
            {busyVariant === "all" && <span className="spinner" />} Regenerare toate variantele
          </button>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {(Object.keys(labels) as DescriptionKind[]).map((kind, index) => (
          <article className="card flex min-h-96 flex-col p-5" key={kind}>
            <div className="mb-5 flex items-center justify-between">
              <span className="result-badge rounded-full px-3 py-1 text-xs font-black">{index + 1}. {labels[kind]}</span>
              <span className="muted text-xs">~{value[kind].description.length} caractere</span>
            </div>
            <h3 className="text-xl font-black">{value[kind].title}</h3>
            <DescriptionPreview text={value[kind].description} />
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button className="button" onClick={() => copy(kind)}>{copied === kind ? "Copiat!" : "Copiază"}</button>
              <button className="button ghost" disabled={busyVariant !== null || externalBusy} onClick={() => onRegenerate(kind)}>
                {busyVariant === kind ? "Se generează…" : "Regenerează"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
