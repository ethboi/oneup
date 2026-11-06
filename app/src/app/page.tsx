"use client";

import { useEffect, useState } from "react";
import { Agents } from "@/components/Agents";
import { scrollToAnchorWhenReady } from "@/lib/anchors";
import { Boot } from "@/components/Boot";
import { OneUpProvider, useOneUp } from "@/lib/oneup";
import { Header } from "@/components/Header";
import { Trade } from "@/components/Trade";
import { Lives } from "@/components/Lives";
import { Locks } from "@/components/Locks";
import { Market } from "@/components/Market";
import { Solvency } from "@/components/Solvency";
import { About } from "@/components/About";
import { BackPage } from "@/components/BackPage";
import { Leaderboard } from "@/components/Leaderboard";
import { Tokenomics } from "@/components/Tokenomics";
import { Toasts } from "@/components/Toasts";
import { SoundEvents } from "@/components/Sounds";
import { AchievementWatcher, BadgesDialog } from "@/components/Achievements";
import { FullHeal } from "@/components/FullHeal";
import { JackpotWin } from "@/components/JackpotWin";
import { EpochResults } from "@/components/EpochResults";
import { Icon, type IconName } from "@/components/Icon";
import { Logo } from "@/components/Pixel";

const TABS = ["Trade", "Life NFTs", "Locks", "Market", "Agents", "Leaders", "Backing", "$1UP", "House", "About"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, IconName> = {
  Trade: "chart",
  "Life NFTs": "heart",
  Locks: "lock",
  Market: "store",
  Agents: "agent",
  Leaders: "trophy",
  Backing: "deposit",
  $1UP: "claim",
  House: "shield",
  About: "info",
};
/** Phones: the four you use; the ones you read sit behind More. */
const PHONE_TABS: Tab[] = ["Trade", "Life NFTs", "Locks", "Market"];
/** Desktop: the reading tabs sit under More. */
const MORE_TABS: Tab[] = ["Leaders", "Backing", "$1UP", "House", "About"];
/** Below 1280px these join them, so the bar fits beside the round strip. */
const NARROW_MORE_TABS: Tab[] = [];
const PHONE_LABEL: Partial<Record<Tab, string>> = {};

/** Each tab's address: /locks, /life-nfts, /house… (Trade is the root). */
const slug = (t: Tab) => (t === "Trade" ? "" : t.toLowerCase().replace(/\$/g, "").replace(/\s+/g, "-"));
/** The tab's earlier address, so links already shared still open it. */
const OLD_PATHS: Record<string, string> = { "extra-lives": "life-nfts" };
const fromPath = (path: string): Tab => {
  const name = path.replace(/^\/+|\/+$/g, "").toLowerCase();
  return TABS.find((t) => slug(t) === (OLD_PATHS[name] ?? name)) ?? "Trade";
};

export default function Home() {
  const [tab, setTab] = useState<Tab>("Trade");
  const [more, setMore] = useState(false);
  const [anchor, setAnchor] = useState("");
  // the address picks the tab, and Back and Forward move between tabs
  useEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const read = () => {
      setTab(fromPath(location.pathname));
      setAnchor(location.hash.slice(1));
      if (!location.hash) window.scrollTo({ top: 0 });
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("hashchange", read);
      history.scrollRestoration = previousRestoration;
    };
  }, []);
  useEffect(() => {
    if (!anchor || anchor.startsWith("life=")) return;
    return scrollToAnchorWhenReady(anchor, {
      find: (id) => document.getElementById(id),
      observe: (check) => {
        const observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
      },
    });
  }, [tab, anchor]);
  /** Opens a tab at its top, or follows its section through asynchronous loading. */
  const go = (t: Tab, at?: string) => {
    setTab(t);
    setMore(false);
    const url = `/${slug(t)}${location.search}${at ? `#${at}` : ""}`;
    if (url !== location.pathname + location.search + location.hash) history.pushState(null, "", url);
    setAnchor(at ?? "");
    if (at) document.getElementById(at)?.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  };
  return (
    <OneUpProvider>
      {/* what this is, on every page: a hackathon entry running on test money */}
      <div className="bg-[var(--primary)] text-white">
        <div className="mx-auto flex max-w-[1280px] items-center justify-center gap-x-2 px-4 py-1.5 text-center text-[12.5px] font-bold">
          <span>
            <span className="hidden sm:inline">In development for </span>
            <span className="font-extrabold">NEAR HACKATHON</span>
            <span className="hidden sm:inline">, November 2026</span>
            <NetworkLabel />
          </span>
          <button type="button" className="-my-1.5 py-2 underline decoration-dotted underline-offset-2 opacity-90 hover:opacity-100" onClick={() => go("About")}>
            About
          </button>
        </div>
      </div>
      {/* the header spans the window; Trade uses all of it, the reading tabs keep a column */}
      <div className="px-4 pb-24 lg:px-6 lg:pb-16">
        <Header
          tabs={TABS.map((t) => ({
            name: t,
            badge: t === "Life NFTs" ? ("lives" as const) : undefined,
            more: MORE_TABS.includes(t),
            moreWhenNarrow: NARROW_MORE_TABS.includes(t),
          }))}
          tab={tab}
          go={(t) => go(t as Tab)}
        />
        <div className={tab === "Trade" ? undefined : "mx-auto max-w-[1280px] 2xl:max-w-[1440px]"}>
          {tab === "Trade" && <Trade />}
          {tab === "Life NFTs" && <Lives />}
          {tab === "Locks" && <Locks />}
          {tab === "Market" && <Market />}
          {tab === "Agents" && <Agents />}
          {tab === "Leaders" && <Leaderboard />}
          {tab === "Backing" && <BackPage go={(t) => go(t as Tab)} />}
          {tab === "$1UP" && <Tokenomics />}
          {tab === "House" && <Solvency />}
          {tab === "About" && <About />}
          <Footer go={go} />
        </div>
      </div>

      {/* phones: a bottom tab bar */}
      <nav className="bottom-nav lg:hidden" aria-label="Sections">
        {more && (
          <div className="absolute inset-x-3 bottom-[68px] flex flex-col gap-1 rounded-xl border border-[var(--panel-edge)] bg-[var(--panel)] p-2 shadow-[var(--panel-shadow)]">
            {(["Agents", "Leaders", "Backing", "$1UP", "House", "About"] as const).map((t) => (
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
        <button aria-current={tab === "Agents" || tab === "Leaders" || tab === "Backing" || tab === "$1UP" || tab === "House" || tab === "About" ? "page" : undefined} aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon name="more" size={20} />
          More
        </button>
      </nav>
      <Toasts />
      <SoundEvents />
      <AchievementWatcher automatic={tab === "Trade"} />
      <BadgesDialog />
      <FullHeal automatic={tab === "Trade"} />
      <JackpotWin automatic={tab === "Trade"} />
      <EpochResults automatic={tab === "Trade"} />
      <Boot />
    </OneUpProvider>
  );
}

/** What OneUp is and where to read more, under every tab. */
function NetworkLabel() {
  const { d } = useOneUp();
  return (
    <>
      <span className="sm:hidden"> · {d.network === "testnet" ? "testnet" : "local demo"}, test money</span>
      {/* wider screens: the header's badge names a public network */}
      <span className="hidden sm:inline">{d.network === "testnet" ? "" : " · local NEAR demo"} · test money only</span>
    </>
  );
}

function Footer({ go }: { go: (t: Tab, at?: string) => void }) {
  const { d } = useOneUp();
  const link = "font-semibold text-[var(--muted)] underline-offset-2 transition-colors hover:text-[var(--text)] hover:underline";
  const body = (
    <>
      <div className="grid gap-6 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex items-start gap-3">
          <Logo size={30} />
          <div>
            <b className="display text-base">OneUp</b>
            <p className="label mt-0.5 max-w-sm">
              Trade perpetual futures with capped profits. Eligible losses may earn a Life NFT: claim its available USDC or sell it. Recovery depends on house profits and is not guaranteed.
            </p>
          </div>
        </div>
        <div>
          <b className="block text-[var(--text)]">Read more</b>
          <ul className="label mt-1.5 flex flex-col gap-1">
            <li>
              <a className={link} href={process.env.ONEUP_SITE_URL}>
                OneUp website
              </a>
            </li>
            <li>
              <button type="button" className={link} onClick={() => go("About")}>
                How it works
              </button>
            </li>
            <li>
              <button type="button" className={link} onClick={() => go("House")}>
                How payout reserves work
              </button>
            </li>
            <li>
              <button type="button" className={link} onClick={() => go("House", "fairness")}>
                Recovery scenarios
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
            {d.network === "localnet" ? "Runs locally on NEAR with Rust contracts, simulated cross-chain deposits through NEAR Intents, Sputnik DAO ownership, sponsored trading, and AI agents trading through MCP." : "NEAR testnet contracts with wallet-approved transactions. Oracle, tokens, swap and vault are test implementations. Rankings and history come from the contracts' events."}
          </p>
          <button
            type="button"
            className={`${link} label mt-1.5`}
            onClick={() => {
              go("About");
              setTimeout(() => document.getElementById("built")?.scrollIntoView({ behavior: "smooth" }), 50);
            }}
          >
            Explore the NEAR integrations
          </button>
        </div>
      </div>
      <div className="label mt-6 flex flex-col gap-2 border-t border-[var(--line)] pt-4 sm:flex-row sm:items-baseline sm:justify-between">
        <p>{d.network === "testnet" ? "A NEAR testnet prototype" : "A local NEAR demo"} using test money. The contracts have not been independently audited. Do not use real funds.</p>
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
    </>
  );
  return (
    <footer className="mt-10 border-t border-[var(--line)] pt-6 text-sm">
      <div className="hidden sm:block">{body}</div>
      <details className="sm:hidden">
        <summary className="label cursor-pointer py-2">{d.network === "testnet" ? "A NEAR testnet prototype" : "A local NEAR demo"} using test money. Not audited. More</summary>
        <div className="mt-3">{body}</div>
      </details>
    </footer>
  );
}
