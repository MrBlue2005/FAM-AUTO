import { DescriptionTemplates } from "@/components/DescriptionTemplates";

export default function TemplatesPage() {
  return (
    <main className="shell py-10 md:py-16">
      <p className="eyebrow">Standardizare editorială</p>
      <h1 className="mt-2 text-4xl font-black tracking-tight">Modele de descrieri</h1>
      <p className="muted mb-8 mt-3 max-w-3xl leading-7">
        Definește structura, emoji-urile și informațiile dorite. La generare, secțiunile fără date aplicabile sunt omise, iar informațiile relevante fără corespondent în model sunt integrate natural.
      </p>
      <DescriptionTemplates />
    </main>
  );
}