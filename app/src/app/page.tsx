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
import { Onboarding } from "@/components/Onboarding";
import { Icon, type IconName } from "@/components/Icon";

const TABS = ["Trade", "Extra Lives", "Locks", "Market", "Solvency", "Fairness"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, IconName> = {
  Trade: "chart",
  "Extra Lives": "heart",
  Locks: "lock",
  Market: "store",
  Solvency: "shield",
  Fairness: "scale",
};
/** Phones: the four you use, the two you read behind More. */
const PHONE_TABS: Tab[] = ["Trade", "Extra Lives", "Locks", "Market"];
const PHONE_LABEL: Partial<Record<Tab, string>> = { "Extra Lives": "Lives" };

export default function Home() {
  const [tab, setTab] = useState<Tab>("Trade");
  const [more, setMore] = useState(false);
  const go = (t: Tab) => {
    setTab(t);
    setMore(false);
    window.scrollTo({ top: 0 });
  };
  return (
    <OneUpProvider>
      <div className="mx-auto max-w-[1280px] px-4 pb-24 lg:pb-16">
        <Header tabs={TABS.map((t) => ({ name: t, badge: t === "Extra Lives" ? ("lives" as const) : undefined }))} tab={tab} go={(t) => go(t as Tab)} />
        <Onboarding />
        {tab === "Trade" && <Trade />}
        {tab === "Extra Lives" && <Lives />}
        {tab === "Locks" && <Locks />}
        {tab === "Market" && <Market />}
        {tab === "Solvency" && <Solvency />}
        {tab === "Fairness" && <Fairness />}
      </div>

      {/* phones: a bottom tab bar */}
      <nav className="bottom-nav lg:hidden" aria-label="Sections">
        {more && (
          <div className="absolute inset-x-3 bottom-[68px] flex flex-col gap-1 rounded-xl border border-[var(--panel-edge)] bg-[var(--panel)] p-2 shadow-[var(--panel-shadow)]">
            {(["Solvency", "Fairness"] as const).map((t) => (
              <button key={t} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left font-bold hover:bg-[var(--panel-2)]" onClick={() => go(t)}>
                <Icon name={TAB_ICONS[t]} />
                {t}
              </button>
            ))}
          </div>
        )}
        {PHONE_TABS.map((t) => (
          <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => go(t)}>
            <Icon name={TAB_ICONS[t]} size={20} />
            {PHONE_LABEL[t] ?? t}
          </button>
        ))}
        <button aria-current={tab === "Solvency" || tab === "Fairness" ? "page" : undefined} aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name="more" size={20} />
          More
        </button>
      </nav>
      <Toasts />
    </OneUpProvider>
  );
}
