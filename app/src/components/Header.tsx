"use client";

import { useEffect, useState } from "react";
import { USDC, fmtUsdc, ONEUP } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Logo, PixelCoin, PixelHeart } from "./Pixel";
import { Icon } from "./Icon";
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

  return (
    <header className="mb-4 flex items-center gap-2 border-b border-[var(--line)] py-3 sm:gap-4 lg:mb-5">
      <div className="flex shrink-0 items-center gap-2">
        <Logo size={34} />
        <span className="display hidden text-[22px] leading-none sm:inline">OneUp</span>
      </div>
      <nav className="hidden min-w-0 flex-1 lg:block" aria-label="Sections">
        <div className="tabs" role="tablist">
          {tabs
            .filter((t) => !t.more)
            .map((t) => (
              <button key={t.name} role="tab" aria-selected={tab === t.name} onClick={() => go(t.name)} className="tab">
                {t.name}
                {t.badge === "lives" && alive > 0 && <span className="tab-badge num">{alive}</span>}
              </button>
            ))}
          <MoreTabs tabs={tabs.filter((t) => t.more)} tab={tab} go={go} />
        </div>
      </nav>
      {/* the round's clock and your result in it, one strip like the chart's market bar */}
      <div className="flex min-w-0 flex-1 justify-end lg:flex-none">
        <div className="bar-strip num min-h-[38px] text-sm">
          <span className="bar-cell" title={`Round ${epoch?.id ?? ""} ends in ${fmtClock(left)}, with Extra Lives and $1UP locks for its losers`}>
            {/* the label goes on narrow desktops too, where the tabs need the room */}
            <span className="label hidden sm:inline lg:hidden xl:inline">Round {epoch?.id ?? "…"}</span>
            <b>{fmtClock(left)}</b>
          </span>
          {round && (
            <span
              className="bar-cell"
              title={
                round.net < 0n
                  ? "Your net loss this round. When the round ends it becomes an Extra Life and a $1UP lock, sized from the house's profit."
                  : "Your net profit this round, after the winner's cut."
              }
            >
              <span className="label hidden sm:inline">You</span>
              <b style={{ color: round.net < 0n ? "var(--short)" : "var(--long)" }}>
                {round.net < 0n ? "−" : "+"}${fmtUsdc(round.net < 0n ? -round.net : round.net, (round.net < 0n ? -round.net : round.net) < 100n * USDC ? 2 : 0)}
              </b>
              {round.net < 0n && (
                <span aria-label="Extra Life at the end of the round">
                  <PixelHeart size={14} />
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      <MuteButton />
      <DemoMenu />
      <AccountMenu />
    </header>
  );
}

/** Localnet tools: act as any demo account, and get test USDC. */
/** Wins to preview the close effect with, one per tier (lib/fx.ts winTier). */
const PREVIEW_WINS = [20, 200, 1_200, 5_000];

function DemoMenu() {
  const { o, me, setMe, accounts, tx, run } = useOneUp();
  const markets = usePoll(() => o.markets(), [], 30_000) ?? [];
  const [amount, setAmount] = useState("10000");
  const amt = BigInt(Math.floor(Number(amount) || 0)) * USDC;
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
            <span className="label">Act as</span>
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
              <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Faucet amount" inputMode="decimal" />
              <span className="field-unit">USDC</span>
            </span>
            <button className="btn btn-ghost" disabled={amt === 0n} onClick={() => run(`Faucet ${amount} USDC`, () => tx.faucet(amt))}>
              <Icon name="faucet" />
              Faucet
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <span className="label">Preview a win on the chart (nothing is traded)</span>
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
        </div>
      )}
    </Popover>
  );
}

/** Your account: wallet and trading balances, and moving USDC between them. Trades top themselves up, so
 *  depositing first is optional. */
function AccountMenu() {
  const { o, me, tx, run } = useOneUp();
  const free = usePoll(() => o.balance(me), [me]);
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const oneup = usePoll(() => o.oneupBalance(me), [me]);
  const [amount, setAmount] = useState("1000");
  const amt = BigInt(Math.floor(Number(amount) || 0)) * USDC;
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
          <p className="label">Optional: placing a trade moves what it needs from your wallet in the same step.</p>
          <ChainDeposit />
          <FastTrading />
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
  const usdc = BigInt(Math.floor(Number(amount) || 0)) * USDC;
  const leftovers = Object.entries(held ?? {}).filter(([, v]) => v > 0n);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] p-3">
      <div className="text-sm font-bold">Deposit from another chain</div>
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
          run(`Deposit $${amount} from ${a.symbol} on ${a.chain}`, () =>
            payFromChain({ o, d, main, keyString: mainKey, asset: a, usdc, then: { kind: "deposit" }, onStep: setStep }).finally(() => setStep(null)),
          )
        }
      >
        {step ? (
          <>
            <Icon name="spinner" /> {step}
          </>
        ) : (
          "Deposit via NEAR Intents"
        )}
      </button>
      <p className="label">The bridge is simulated on this local chain; the swap runs on the real NEAR Intents Verifier.</p>
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
        A key on this device that can only open, close and set TP/SL. It can&apos;t deposit or withdraw.
      </p>
      {session && (
        <>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Gas paid by OneUp</span>
            <input type="checkbox" checked={session.gasless} onChange={(e) => saveSession(me, { ...session, gasless: e.target.checked })} />
          </label>
          <dl className="num grid grid-cols-2 gap-y-0.5 text-xs">
            <dt className="label">Key gas budget</dt>
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
      Show results after each epoch
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

export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
export const fmtOneup = (x?: string, digits = 0) =>
  x === undefined ? "…" : (Number(BigInt(x) / (ONEUP / 1000n)) / 1000).toLocaleString("en-US", { maximumFractionDigits: digits });

/**
 * Your result this round, or null before your first close in it. A net loss comes from the house itself (the
 * pending Extra Life, exact); a profit from your closes since the round began, after the winner's cut.
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
  const current = tabs.find((t) => t.name === tab);
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
              className="rounded-lg px-3 py-2 text-left text-sm font-bold hover:bg-[var(--panel-2)]"
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
