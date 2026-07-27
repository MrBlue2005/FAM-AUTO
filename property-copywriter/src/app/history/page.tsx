import { HistoryList } from "@/components/HistoryList";

export default function HistoryPage() {
  return <main className="shell py-10 md:py-16">
    <p className="eyebrow">Arhivă locală</p>
    <h1 className="mt-2 text-4xl font-black tracking-tight">Istoric proprietăți</h1>
    <p className="muted mb-8 mt-3">Redeschide datele corectate, copiază textele sau regenerează variantele.</p>
    <HistoryList />
  </main>;
}
