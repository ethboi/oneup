"use client";

import { useState } from "react";
import { OneUpProvider } from "@/lib/oneup";
import { Header } from "@/components/Header";
import { Trade } from "@/components/Trade";
import { Lives } from "@/components/Lives";
import { Vote } from "@/components/Vote";
import { Solvency } from "@/components/Solvency";
import { Fairness } from "@/components/Fairness";
import { Toasts } from "@/components/Toasts";

const TABS = ["Trade", "Extra Lives", "Vote", "Solvency", "Fairness"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [tab, setTab] = useState<Tab>("Trade");
  return (
    <OneUpProvider>
      <div className="mx-auto max-w-[1280px] px-4 pb-16">
        <Header />
        <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--line)]">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-semibold ${
                tab === t ? "border-b-2 border-[var(--accent)] text-[var(--text)]" : "text-[var(--muted)]"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
        {tab === "Trade" && <Trade />}
        {tab === "Extra Lives" && <Lives />}
        {tab === "Vote" && <Vote />}
        {tab === "Solvency" && <Solvency />}
        {tab === "Fairness" && <Fairness />}
      </div>
      <Toasts />
    </OneUpProvider>
  );
}
