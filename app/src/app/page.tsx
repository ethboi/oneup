"use client";

import { useState } from "react";
import { OneUpProvider } from "@/lib/oneup";
import { Header } from "@/components/Header";
import { Trade } from "@/components/Trade";
import { Lives } from "@/components/Lives";
import { Locks } from "@/components/Locks";
import { Market } from "@/components/Market";
import { Solvency } from "@/components/Solvency";
import { Fairness } from "@/components/Fairness";
import { Toasts } from "@/components/Toasts";
import { Icon, type IconName } from "@/components/Icon";

const TABS = ["Trade", "Extra Lives", "Locks", "Market", "Solvency", "Fairness"] as const;
const TAB_ICONS: Record<(typeof TABS)[number], IconName> = {
  Trade: "chart",
  "Extra Lives": "heart",
  Locks: "lock",
  Market: "store",
  Solvency: "shield",
  Fairness: "scale",
};
type Tab = (typeof TABS)[number];

export default function Home() {
  const [tab, setTab] = useState<Tab>("Trade");
  return (
    <OneUpProvider>
      <div className="mx-auto max-w-[1280px] px-4 pb-16">
        <Header />
        <nav className="mb-4 overflow-x-auto" aria-label="Sections">
          <div className="inline-flex gap-1 rounded-[14px] border border-[var(--edge)] bg-[var(--bezel)] p-1" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="tab">
                <Icon name={TAB_ICONS[t]} size={15} />
                {t}
              </button>
            ))}
          </div>
        </nav>
        {tab === "Trade" && <Trade />}
        {tab === "Extra Lives" && <Lives />}
        {tab === "Locks" && <Locks />}
        {tab === "Market" && <Market />}
        {tab === "Solvency" && <Solvency />}
        {tab === "Fairness" && <Fairness />}
      </div>
      <Toasts />
    </OneUpProvider>
  );
}
