"use client";

import { parseTokenAmount } from "@oneup/sdk";
import { SKINS } from "@/lib/achievements";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { previewTilt } from "@/lib/tilt";
import { showBoot } from "./Boot";
import { USDC, fmtUsdc, ONEUP } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Logo, PixelCoin, PixelHeart } from "./Pixel";
import { Icon } from "./Icon";
import { WalletActions } from "./WalletActions";
import { Popover } from "./Popover";
import { MuteButton } from "./Sounds";
import { openBadges } from "./Achievements";
import { useHistory } from "./History";
import { emitFx, winTier } from "@/lib/fx";
import { sfx } from "@/lib/sound";
import { endSession, saveSession, sessionAllowance, startSession } from "@/lib/session";
import { intentsBalances, payFromChain } from "@/lib/intents";

export interface NavTab {
  name: string;
  badge?: "lives";
  /** Shown under "More" rather than in the bar. */
  more?: boolean;
  /** In the bar on wide desktops (1280px+), under "More" below that. */
  moreWhenNarrow?: boolean;
}

/** One bar: brand, the section tabs (desktop), your result this round and the epoch clock as plain text, Demo, and
 *  your account. */
export function Header({ tabs, tab, go }: { tabs: readonly NavTab[]; tab: string; go: (t: string) => void }) {
  const { o, d, me } = useOneUp();
  const epoch = usePoll(() => o.epoch(), []);
  const lives = usePoll(() => o.lives(me), [me]);
  const now = useNow();
  const left = epoch ? Math.max(0, epoch.started_at + d.epochLengthS - now) : 0;
  const alive = lives?.filter((l) => !l.expired && !l.full_heal).length ?? 0;
  const round = useMyRound(me, epoch?.started_at);
  // tabs that don't fit beside the strip fold into More from the end, one at a time until the bar fits
  const nav = useRef<HTMLElement>(null);
  const bar = tabs.filter((t) => !t.more);
  const [fold, setFold] = useState(0);
  const folded = new Set(bar.slice(bar.length - fold).map((t) => t.name));
  useLayoutEffect(() => {
    const n = nav.current;
    if (n && n.scrollWidth > n.clientWidth + 1 && fold < bar.length - 1) setFold(fold + 1);
  });
  useEffect(() => {
    const n = nav.current;
    if (!n) return;
    // the strip grows (your result this round arrives) or the window resizes: measure again from none folded
    const ro = new ResizeObserver(() => setFold(0));
    ro.observe(n);
    return () => ro.disconnect();
  }, []);

  return (
    <header className="mb-4 flex items-center gap-2 border-b border-[var(--line)] py-3 sm:gap-4 lg:mb-5">
      {/* the way back to the website */}
      <a href={process.env.ONEUP_SITE_URL} className="flex shrink-0 items-center gap-2" title="OneUp website" aria-label="OneUp website">
        <Logo size={34} />
        {/* the wordmark makes way for the tabs on small desktops */}
        <span className="display hidden text-[22px] leading-none sm:inline lg:hidden xl:inline">OneUp</span>
      </a>
      <nav ref={nav} className="hidden min-w-0 flex-1 lg:block" aria-label="Sections">
        <div className="tabs" role="tablist">
          {bar
            .filter((t) => !folded.has(t.name))
            .map((t) => (
              <button
                key={t.name}
                role="tab"
                aria-selected={tab === t.name}
                onClick={() => go(t.name)}
                className={`tab ${t.moreWhenNarrow ? "hidden xl:inline-flex" : ""}`}
              >
                {t.name}
                {t.badge === "lives" && alive > 0 && <span className="tab-badge num">{alive}</span>}
              </button>
            ))}
          <MoreTabs
            tabs={tabs.filter((t) => t.more || t.moreWhenNarrow || folded.has(t.name)).map((t) => (folded.has(t.name) ? { ...t, more: true, moreWhenNarrow: false } : t))}
            tab={tab}
            go={go}
          />
        </div>
      </nav>
      {/* the round's clock and your result in it, one strip like the chart's market bar */}
      <div className="flex min-w-0 flex-1 justify-end lg:flex-none">
        <div className="hdr-strip bar-strip num text-sm">
          <span className="bar-cell" title={`Round ${epoch?.id ?? ""} ends in ${fmtClock(left)}. Eligible losses may earn Life NFTs and $1UP locks if the house makes a profit.`}>
            {/* the label goes on narrow desktops too, where the tabs need the room */}
            <span className="label hidden sm:inline lg:hidden 2xl:inline">Round {epoch?.id ?? "…"}</span>
            <b>{fmtClock(left)}</b>
          </span>
          {round && (
            <span
              className="bar-cell"
              title={
                round.net < 0n
                  ? "Your net loss this round. If the house makes a profit, eligible losses may earn a Life NFT and a $1UP lock. Recovery is not guaranteed."
                  : "Your net profit this round, after the fee on profits."
              }
            >
              <span className="label hidden sm:inline">You</span>
              <b style={{ color: round.net < 0n ? "var(--short)" : "var(--long)" }}>
                {round.net < 0n ? "−" : "+"}${fmtUsdc(round.net < 0n ? -round.net : round.net, (round.net < 0n ? -round.net : round.net) < 100n * USDC ? 2 : 0)}
              </b>
              {round.net < 0n && (
                <span aria-label="A Life NFT may be issued if the house makes a profit this round">
                  <PixelHeart size={14} />
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {/* the tools: one height, close together */}
      <div className="hdr-tools flex shrink-0 items-center gap-2">
        <MuteButton />
        {d.network === "localnet" ? <DemoMenu /> : <NetworkBadge network={d.network} />}
        {d.network === "localnet" && <a href="/wallet-setup" className="chip hidden sm:inline-flex">Wallet setup</a>}
        <AccountMenu />
      </div>
    </header>
  );
}

/**
 * Which network this is, the one place the header says so: a status light and its name, the same height as the tools
 * beside it. Amber is test money; green would be mainnet. Phones keep the light, and the banner above names the network.
 */
function NetworkBadge({ network }: { network: string }) {
  const name = network.charAt(0).toUpperCase() + network.slice(1);
  const about = network === "testnet" ? "NEAR testnet: test money only. Wallet and test token help" : `NEAR ${network}`;
  return (
    <a href="/wallet-setup" className="net-badge bar-pill" data-network={network} title={about} aria-label={about}>
      <span className="net-led" aria-hidden />
      <span className="hidden sm:inline">{name}</span>
    </a>
  );
}

/** Localnet tools: act as any demo account, and get test USDC. */
/** Wins to preview the close effect with, one per tier (lib/fx.ts winTier). */
const PREVIEW_WINS = [20, 200, 1_200, 5_000];

function DemoMenu() {
  const { o, me, setMe, accounts, tx, run } = useOneUp();
  const markets = usePoll(() => o.markets(), [], 30_000) ?? [];
  const treasury = usePoll(() => o.treasury(), [], 30_000);
  const jackpotNow = treasury?.jackpot && BigInt(treasury.jackpot) > 0n ? treasury.jackpot : undefined;
  const [amount, setAmount] = useState("10000");
  const amt = parseTokenAmount(amount, 6);
  return (
    <Popover
      label="Demo tools"
      button={
        <>
          <Icon name="demo" />
          <span className="hidden sm:inline">Demo</span>
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <div className="label">Local demo: switch accounts and get test USDC.</div>
          <label className="flex flex-col gap-1">
            <span className="label">Demo account</span>
            <select className="input" value={me} onChange={(e) => (setMe(e.target.value), close())} aria-label="Account">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <span className="field flex-1">
              <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Test USDC amount" inputMode="decimal" />
              <span className="field-unit">USDC</span>
            </span>
            <button className="btn btn-ghost" disabled={amt === 0n} onClick={() => run(`Get ${amount} test USDC`, () => tx.faucet(amt))}>
              <Icon name="faucet" />
              Get test USDC
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <span className="label">Preview a win animation (no trade is placed)</span>
            <div className="flex gap-1.5">
              {PREVIEW_WINS.map((usd) => (
                <button
                  key={usd}
                  type="button"
                  className="chip num flex-1 px-0"
                  onClick={() => {
                    close();
                    const pnl = BigInt(usd) * USDC;
                    const tier = winTier(pnl, 100_000n * USDC);
                    sfx(tier === 3 ? "jackpot" : "win");
                    // the chart shows one market: send it to each, the one on screen plays it
                    markets.forEach((m, i) => emitFx({ kind: "win", market: m.id, positionId: -1 - i, pnl: pnl.toString(), tier }));
                  }}
                >
                  ${usd.toLocaleString("en-US")}
                </button>
              ))}
            </div>
          </div>
          {/* try any console shell for this browser session, unlocked or not */}
          <div className="flex flex-col gap-1">
            <span className="label">Try a console shell</span>
            <div className="flex flex-wrap gap-1.5">
              {SKINS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="skin-dot"
                  data-swatch={s.id}
                  title={s.name}
                  aria-label={`Try the ${s.name} shell`}
                  onClick={() => {
                    try {
                      sessionStorage.setItem("oneup.shellPreview", "1");
                      localStorage.setItem("oneup.skin", s.id);
                    } catch {}
                    document.documentElement.dataset.skin = s.id;
                  }}
                />
              ))}
            </div>
          </div>
          {/* every on-screen moment, on demand: nothing is traded or changed */}
          <div className="flex flex-col gap-1">
            <span className="label">Preview other animations</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["Loss +1", () => (sfx("lose"), markets.forEach((m, i) => emitFx({ kind: "lose", market: m.id, positionId: -10 - i })))],
                  ["Liquidated", () => (sfx("liquidated"), markets.forEach((m, i) => emitFx({ kind: "liquidated", market: m.id, positionId: -20 - i })))],
                  ["Trade review", () => (sfx("revenge"), emitFx({ kind: "revenge" }))],
                  ["Tilt", () => (sfx("tilt"), previewTilt(me))],
                  ["Full Heal", () => emitFx({ kind: "heal", tokenId: "preview", epoch: 1, paid: String(420n * USDC) })],
                  ["Jackpot", () => window.dispatchEvent(new CustomEvent("oneup-preview-jackpot", { detail: jackpotNow }))],
                  ["Round over", () => window.dispatchEvent(new Event("oneup-preview-round"))],
                  ["Badges", () => openBadges()],
                  ["Tier up", () => (sfx("levelup"), emitFx({ kind: "levelup", level: 4 }))],
                  ["Win streak", () => (sfx("combo"), emitFx({ kind: "combo", n: 3 }))],
                  ["TP/SL set", () => (sfx("shield"), emitFx({ kind: "shield" }))],
                  ["Big move", () => (sfx("bigmove"), markets.forEach((m) => emitFx({ kind: "bigmove", market: m.id, pct: 0.24 })))],
                ] as [string, () => void][]
              ).map(([name, go]) => (
                <button key={name} type="button" className="chip px-0 text-xs" onClick={() => (close(), go())}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          {/* the power-on screen shows once a session; this brings it back */}
          <button type="button" className="chip self-start" onClick={() => (close(), showBoot())}>
            Replay the intro
          </button>
        </div>
      )}
    </Popover>
  );
}

/** Your account: wallet and trading balances, and moving USDC between them. Trades top themselves up, so
 *  depositing first is optional. */
function AccountMenu() {
  const { viewOnly, wallet } = useOneUp();
  if (viewOnly)
    return (
      <button type="button" className="btn btn-accent" disabled={wallet.busy} onClick={() => void wallet.connect()}>
        <Icon name="wallet" />
        {wallet.busy ? (
          "Waiting…"
        ) : (
          <span>
            Connect<span className="hidden sm:inline"> wallet</span>
          </span>
        )}
      </button>
    );
  return <AccountFunds />;
}

function AccountFunds() {
  const { o, d, me, tx, run } = useOneUp();
  const free = usePoll(() => o.balance(me), [me]);
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const oneup = usePoll(() => o.oneupBalance(me), [me]);
  const [amount, setAmount] = useState("1000");
  const amt = parseTokenAmount(amount, 6);
  return (
    <Popover
      label="Account and funds"
      button={
        <>
          <Icon name="wallet" />
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm">{me.replace(/\.test\.near$/, "")}</span>
            <span className="label num block font-normal">${wallet ? fmtUsdc(BigInt(wallet), 0) : "…"}</span>
          </span>
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <dl className="num grid grid-cols-2 gap-y-1 text-sm">
            <dt className="label">Wallet</dt>
            <dd className="text-right font-bold">${wallet ? fmtUsdc(BigInt(wallet)) : "…"}</dd>
            <dt className="label">Trading balance</dt>
            <dd className="flex items-center justify-end gap-1.5 font-bold">
              <PixelCoin size={14} />${free ? fmtUsdc(BigInt(free)) : "…"}
            </dd>
            <dt className="label">$1UP</dt>
            <dd className="text-right font-bold">{fmtOneup(oneup)}</dd>
          </dl>
          <span className="field">
            <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC amount" inputMode="decimal" />
            <span className="field-unit">USDC</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-accent" disabled={amt === 0n} onClick={() => run(`Deposit ${amount} USDC`, () => tx.deposit(amt))}>
              <Icon name="deposit" />
              Deposit
            </button>
            <button className="btn btn-ghost" disabled={amt === 0n} onClick={() => run(`Withdraw ${amount} USDC`, () => tx.withdraw(amt))}>
              <Icon name="withdraw" />
              Withdraw
            </button>
          </div>
          <p className="label">You can deposit now, or let your next trade transfer the USDC it needs from your wallet.</p>
          {d.network === "localnet" ? <><ChainDeposit /><FastTrading /></> : <WalletActions />}
          <button className="btn btn-ghost justify-start" onClick={() => (close(), openBadges())}>
            <Icon name="trophy" />
            Achievements and console skins
          </button>
          <RoundsToggle />
        </div>
      )}
    </Popover>
  );
}

/** Deposit from another chain with NEAR Intents (D-21), and what's held in the Verifier. */
function ChainDeposit() {
  const { o, d, me, main, mainKey, run } = useOneUp();
  const assets = d.intents?.assets ?? [];
  const [token, setToken] = useState(assets[0]?.token ?? "");
  const [amount, setAmount] = useState("500");
  const [step, setStep] = useState<string | null>(null);
  const held = usePoll(() => intentsBalances(o, d, me), [me], 5000);
  if (!d.intents) return null;
  const a = assets.find((x) => x.token === token)!;
  const usdc = parseTokenAmount(amount, 6);
  const leftovers = Object.entries(held ?? {}).filter(([, v]) => v > 0n);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] p-3">
      <div className="text-sm font-bold">Simulate a cross-chain deposit</div>
      <div className="flex gap-2">
        <select className="input min-w-0 flex-1" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Source asset">
          {assets.map((x) => (
            <option key={x.token} value={x.token}>
              {x.symbol} on {x.chain}
            </option>
          ))}
        </select>
        <span className="field w-28">
          <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC to receive" inputMode="decimal" />
          <span className="field-unit">USD</span>
        </span>
      </div>
      <button
        className="btn btn-ghost"
        disabled={usdc === 0n || step !== null}
        onClick={() =>
          run(`Simulate $${amount} from ${a.symbol} on ${a.chain}`, () =>
            payFromChain({ o, d, main, keyString: mainKey, asset: a, usdc, then: { kind: "deposit" }, onStep: setStep }).finally(() => setStep(null)),
          )
        }
      >
        {step ? (
          <>
            <Icon name="spinner" /> {step}
          </>
        ) : (
          "Simulate deposit via NEAR Intents"
        )}
      </button>
      <p className="label">This simulates a bridge deposit using the official NEAR Intents contract on a local chain. No funds move from another chain. The first use may need an extra signature.</p>
      {leftovers.length > 0 && (
        <p className="label num">
          Held in NEAR Intents:{" "}
          {leftovers
            .map(([t, v]) => {
              const x = assets.find((y) => y.token === t);
              const dec = x?.decimals ?? 6;
              return `${(Number(v) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${x ? `${x.symbol} (${x.chain})` : "USDC"}`;
            })
            .join(", ")}
        </p>
      )}
    </div>
  );
}

/**
 * One-tap trading: a trade-only session key on this device (lib/session.ts), and optionally gas paid by
 * OneUp's relayer. Shows the key's gas budget and the account's own NEAR, which a gasless trade leaves alone.
 */
function FastTrading() {
  const { d, o, me, main, session, run } = useOneUp();
  const allowance = usePoll(() => (session ? sessionAllowance(o.provider, me, session) : Promise.resolve(null)), [me, session?.publicKey], 5000);
  const near = usePoll(
    () => o.provider.viewAccount({ accountId: me }).then((a) => (a as unknown as { amount: string }).amount),
    [me],
    5000,
  );
  if (!main) return null;
  const fmtNear = (y?: bigint | string | null) => (y == null ? "…" : (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4));
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] p-3">
      <label className="flex items-center justify-between gap-2 text-sm font-bold">
        <span>One-tap trading</span>
        <input
          type="checkbox"
          checked={!!session}
          onChange={(e) =>
            run(e.target.checked ? "Turn on one-tap trading" : "Turn off one-tap trading", () =>
              e.target.checked ? startSession(main, d.contracts.house, true) : endSession(main, session!),
            )
          }
        />
      </label>
      <p className="label">
        A key stored on this device lets you open and close trades and set take-profit or stop-loss prices. It cannot deposit or withdraw funds.
      </p>
      {session && (
        <>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Gas paid by OneUp</span>
            <input type="checkbox" checked={session.gasless} onChange={(e) => saveSession(me, { ...session, gasless: e.target.checked })} />
          </label>
          <dl className="num grid grid-cols-2 gap-y-0.5 text-xs">
            <dt className="label">Session gas budget</dt>
            <dd className="text-right">{allowance === null ? "key removed" : `${fmtNear(allowance)} NEAR`}</dd>
            <dt className="label">Your NEAR</dt>
            <dd className="text-right">{fmtNear(near)}</dd>
          </dl>
        </>
      )}
    </div>
  );
}

/** Whether the "round over" screen shows after each epoch (remembered in this browser). */
function RoundsToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      setOn(localStorage.getItem("oneup.rounds.off") !== "1");
    } catch {}
  }, []);
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          try {
            localStorage.setItem("oneup.rounds.off", e.target.checked ? "0" : "1");
          } catch {}
        }}
      />
      Show results after each round
    </label>
  );
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(i);
  }, [ms]);
  return now;
}

/** Dollars, with cents below $1,000 so small amounts don't read as nothing; `signed` adds + to gains. */
export const fmtUsd = (x: bigint, signed = false) => {
  const a = x < 0n ? -x : x;
  return `${x < 0n ? "−" : signed && x > 0n ? "+" : ""}$${fmtUsdc(a, a < 1_000n * USDC ? 2 : 0)}`;
};
export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
export const fmtOneup = (x?: string, digits = 0) =>
  x === undefined ? "…" : (Number(BigInt(x) / (ONEUP / 1000n)) / 1000).toLocaleString("en-US", { maximumFractionDigits: digits });

/**
 * Your result this round, or null before your first close in it. A net loss comes from the house itself (the
 * pending Life NFT, exact); a profit from your closes since the round began, after the winner's cut.
 */
function useMyRound(me: string, startedAt?: number) {
  const { o } = useOneUp();
  const pending = usePoll(() => o.pendingLife(me), [me]);
  const history = useHistory(me);
  if (startedAt === undefined || pending === undefined) return null;
  if (BigInt(pending) > 0n) return { net: -BigInt(pending) };
  const closes = (history?.items ?? []).filter((i) => i.kind === "trade" && i.trade.closed_t >= startedAt * 1000);
  if (closes.length === 0) return null;
  const net = closes.reduce((s, i) => (i.kind === "trade" ? s + BigInt(i.trade.pnl) - BigInt(i.trade.cut ?? 0) : s), 0n);
  return net > 0n ? { net } : null;
}

/** The reading tabs, under one "More" in the bar (the phone's bottom bar has its own). */
function MoreTabs({ tabs, tab, go }: { tabs: NavTab[]; tab: string; go: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  // the label shows the current tab only for the ones that live under More at every width
  const current = tabs.find((t) => t.name === tab && t.more);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", close);
    };
  }, [open]);
  if (tabs.length === 0) return null;
  return (
    <div className="relative">
      <button type="button" role="tab" aria-selected={!!current} aria-haspopup="menu" aria-expanded={open} className="tab" onClick={() => setOpen(!open)}>
        {current ? current.name : "More"}
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div role="menu" className="panel absolute left-0 top-full z-40 mt-1 flex min-w-40 flex-col p-1.5">
          {tabs.map((t) => (
            <button
              key={t.name}
              role="menuitem"
              type="button"
              // tabs in the bar on wide screens only appear here below 1280px
              className={`rounded-lg px-3 py-2 text-left text-sm font-bold hover:bg-[var(--panel-2)] ${t.moreWhenNarrow ? "xl:hidden" : ""}`}
              style={t.name === tab ? { color: "var(--primary)" } : undefined}
              onClick={() => go(t.name)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
