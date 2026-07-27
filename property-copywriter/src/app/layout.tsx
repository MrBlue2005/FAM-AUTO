import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "RX CREATIVE Tool — Aim for perfection",
  description: "Analizează proprietăți Zonere și generează descrieri validate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const hubUrl = process.env.NEXT_PUBLIC_HUB_URL || "http://127.0.0.1:5173";
  return (
    <html lang="ro">
      <body>
        <header className="app-header">
          <div className="shell flex min-h-18 items-center justify-between">
            <Link href="/" className="flex items-center gap-3 font-black tracking-tight">
              <span className="brand-mark">RX</span>
              <span>
                <span className="brand-name">RX CREATIVE <span className="text-[#86efac]">Tool</span></span>
                <span className="brand-tagline">Aim for perfection</span>
              </span>
            </Link>
            <nav className="flex gap-2 text-sm font-bold">
              <a className="nav-link" href={hubUrl}>Aplicații</a>
              <Link className="nav-link" href="/">Generator</Link>
              <Link className="nav-link" href="/history">Istoric</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
