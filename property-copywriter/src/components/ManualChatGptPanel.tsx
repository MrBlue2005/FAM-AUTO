"use client";

type Props = {
  prompt: string;
  response: string;
  info: string | null;
  error: string | null;
  busy: boolean;
  onResponseChange: (value: string) => void;
  onCopyPrompt: () => void;
  onImport: () => void;
  onClose: () => void;
};

export function ManualChatGptPanel({
  prompt,
  response,
  info,
  error,
  busy,
  onResponseChange,
  onCopyPrompt,
  onImport,
  onClose,
}: Props) {
  return (
    <section className="card manual-chatgpt-card overflow-hidden p-5 md:p-7">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="eyebrow">Flux fără cheie API</p>
          <h2 className="mt-2 text-2xl font-black">Generează în ChatGPT și importă rezultatul</h2>
          <p className="muted mt-2 max-w-3xl text-sm leading-6">
            Promptul este construit din datele verificate. Tu îl trimiți în ChatGPT și copiezi răspunsul înapoi aici.
          </p>
        </div>
        <button className="button ghost self-start" type="button" onClick={onClose}>Închide</button>
      </div>

      <div className="manual-steps mt-6 grid gap-3 md:grid-cols-3">
        <div><span>1</span><strong>Prompt copiat</strong><p>Deschide ChatGPT și lipește promptul.</p></div>
        <div><span>2</span><strong>Generează JSON-ul</strong><p>Așteaptă răspunsul cu cele trei variante.</p></div>
        <div><span>3</span><strong>Importă rezultatul</strong><p>Copiază răspunsul complet și lipește-l mai jos.</p></div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="button secondary" type="button" onClick={onCopyPrompt}>Copiază promptul din nou</button>
        <a className="button secondary" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">
          Deschide ChatGPT <span aria-hidden="true">↗</span>
        </a>
      </div>

      <details className="manual-prompt mt-4">
        <summary>Vezi promptul pregătit</summary>
        <textarea className="control mt-3 min-h-52 resize-y font-mono text-xs leading-5" readOnly value={prompt} />
      </details>

      <div className="field mt-5">
        <label htmlFor="manualChatGptResponse">Răspunsul JSON primit din ChatGPT</label>
        <textarea
          id="manualChatGptResponse"
          className="control min-h-64 resize-y font-mono text-sm leading-6"
          placeholder={'Lipește aici răspunsul care începe cu {"commercial": ...}'}
          value={response}
          onChange={(event) => onResponseChange(event.target.value)}
        />
      </div>

      {info && <div className="notice mt-4">{info}</div>}
      {error && <div className="notice error mt-4" role="alert">{error}</div>}

      <div className="mt-5 flex justify-end">
        <button className="button min-w-60" type="button" disabled={busy || !response.trim()} onClick={onImport}>
          {busy && <span className="spinner" />} {busy ? "Importăm textele…" : "Importă cele 3 texte"}
        </button>
      </div>
    </section>
  );
}
