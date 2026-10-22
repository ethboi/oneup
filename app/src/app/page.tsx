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
import { About } from "@/components/About";
import { BackPage } from "@/components/BackPage";
import { Leaderboard } from "@/components/Leaderboard";
import { Tokenomics } from "@/components/Tokenomics";
import { Toasts } from "@/components/Toasts";
import { SoundEvents } from "@/components/Sounds";
import { AchievementWatcher, BadgesDialog } from "@/components/Achievements";
import { FullHeal } from "@/components/FullHeal";
import { EpochResults } from "@/components/EpochResults";
import { Onboarding } from "@/components/Onboarding";
import { Icon, type IconName } from "@/components/Icon";
import { Logo } from "@/components/Pixel";

const TABS = ["Trade", "Extra Lives", "Locks", "Market", "Leaders", "Backing", "$1UP", "Solvency", "Fairness", "About"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, IconName> = {
  Trade: "chart",
  "Extra Lives": "heart",
  Locks: "lock",
  Market: "store",
  Leaders: "trophy",
  Backing: "deposit",
  $1UP: "claim",
  Solvency: "shield",
  Fairness: "scale",
  About: "info",
};
/** Phones: the four you use; the ones you read sit behind More. */
const PHONE_TABS: Tab[] = ["Trade", "Extra Lives", "Locks", "Market"];
/** Desktop: the reading tabs sit under More. */
const MORE_TABS: Tab[] = ["Solvency", "Fairness", "About"];
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
      {/* what this is, on every page: a hackathon entry running on test money */}
      <div className="bg-[var(--primary)] text-white">
        <div className="mx-auto flex max-w-[1280px] items-center justify-center gap-x-2 px-4 py-1.5 text-center text-[12.5px] font-bold">
          <span>
            Our entry for <span className="font-extrabold">NEAR HACKATHON</span>, November 2026
            <span className="hidden sm:inline"> · a proof of concept on a local NEAR chain, with test money only</span>
          </span>
          <button type="button" className="underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100" onClick={() => go("About")}>
            About
          </button>
        </div>
      </div>
      <div className="mx-auto max-w-[1280px] px-4 pb-24 lg:pb-16">
        <Header
          tabs={TABS.map((t) => ({ name: t, badge: t === "Extra Lives" ? ("lives" as const) : undefined, more: MORE_TABS.includes(t) }))}
          tab={tab}
          go={(t) => go(t as Tab)}
        />
        <Onboarding />
        {tab === "Trade" && <Trade />}
        {tab === "Extra Lives" && <Lives />}
        {tab === "Locks" && <Locks />}
        {tab === "Market" && <Market />}
        {tab === "Leaders" && <Leaderboard />}
        {tab === "Backing" && <BackPage go={(t) => go(t as Tab)} />}
        {tab === "$1UP" && <Tokenomics />}
        {tab === "Solvency" && <Solvency />}
        {tab === "Fairness" && <Fairness />}
        {tab === "About" && <About />}
        <Footer go={go} />
      </div>

      {/* phones: a bottom tab bar */}
      <nav className="bottom-nav lg:hidden" aria-label="Sections">
        {more && (
          <div className="absolute inset-x-3 bottom-[68px] flex flex-col gap-1 rounded-xl border border-[var(--panel-edge)] bg-[var(--panel)] p-2 shadow-[var(--panel-shadow)]">
            {(["Leaders", "Backing", "$1UP", "Solvency", "Fairness", "About"] as const).map((t) => (
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
        <button aria-current={tab === "Solvency" || tab === "Fairness" || tab === "About" ? "page" : undefined} aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name="more" size={20} />
          More
        </button>
      </nav>
      <Toasts />
      <SoundEvents />
      <AchievementWatcher />
      <BadgesDialog />
      <FullHeal />
      <EpochResults />
    </OneUpProvider>
  );
}

/** What OneUp is and where to read more, under every tab. */
function Footer({ go }: { go: (t: Tab) => void }) {
  const link = "font-bold text-[var(--text)] underline decoration-dotted underline-offset-2";
  return (
    <footer className="mt-10 border-t border-[var(--line)] pt-6 text-sm">
      <div className="grid gap-6 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex items-start gap-3">
          <Logo size={30} />
          <div>
            <b className="display text-base">OneUp</b>
            <p className="label mt-0.5 max-w-sm">
              Perps against a house that can&apos;t go bust. Lose a trade, get a life. Our entry for NEAR HACKATHON, November 2026.
            </p>
          </div>
        </div>
        <div>
          <b className="block">Read more</b>
          <ul className="label mt-1.5 flex flex-col gap-1">
            <li>
              <button type="button" className={link} onClick={() => go("About")}>
                How it works
              </button>
            </li>
            <li>
              <button type="button" className={link} onClick={() => go("Solvency")}>
                Why the house can&apos;t go bust
              </button>
            </li>
            <li>
              <button type="button" className={link} onClick={() => go("Fairness")}>
                Fair to late players
              </button>
            </li>
            <li>
              <button type="button" className={link} onClick={() => go("Backing")}>
                Back the house
              </button>
            </li>
            <li>
              <button type="button" className={link} onClick={() => go("$1UP")}>
                $1UP tokenomics
              </button>
            </li>
          </ul>
        </div>
        <div>
          <b className="block">Built on NEAR</b>
          <p className="label mt-1.5">
            Rust contracts (near-sdk), NEAR Intents deposits, a Sputnik DAO owning the house, gasless one-tap trading, and an MCP server
            for AI agents.
          </p>
          <button
            type="button"
            className={`${link} label mt-1.5`}
            onClick={() => {
              go("About");
              setTimeout(() => document.getElementById("built")?.scrollIntoView({ behavior: "smooth" }), 50);
            }}
          >
            Every NEAR tool we use
          </button>
        </div>
      </div>
      <div className="label mt-6 flex flex-col gap-2 border-t border-[var(--line)] pt-4 sm:flex-row sm:items-baseline sm:justify-between">
        <p>A proof of concept running on a local NEAR chain with test money. The contracts haven&apos;t been audited: don&apos;t use real funds.</p>
        <p className="shrink-0">
          Built by{" "}
          <a className={link} href="https://github.com/ethboi" target="_blank" rel="noreferrer">
            ethboi
          </a>{" "}
          ·{" "}
          <a className={link} href="https://x.com/ethboi_" target="_blank" rel="noreferrer">
            @ethboi_ on X
          </a>
        </p>
      </div>
    </footer>
  );
}
