import { Suspense } from "react";
import { Workbench } from "@/components/Workbench";

export default function HomePage() {
  const demo = process.env.DEMO_MODE === "true" || !process.env.OPENAI_API_KEY;
  return <Suspense fallback={<main className="shell py-16">Se încarcă generatorul…</main>}><Workbench demo={demo} /></Suspense>;
}
