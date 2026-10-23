"use client";

import { parseTokenAmount } from "@oneup/sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ONEUP_PER_USDC,
  PPM,
  USDC,
  fmtUsdc,
  lifeCapPpm,
  liquidationPrice,
  maxLiability,
  numberToPrice,
  owed,
  pnl,
  priceToNumber,
  stopHit,
  targetHit,
  type Market,
  type Order,
  type Position,
  type Side,
} from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { PriceChart, type Mark } from "./PriceChart";
import { fmtClock, useNow } from "./Header";
import { AngryHeart, FallingCandles, PixelCoin, PixelHeart } from "./Pixel";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { useTilt } from "@/lib/tilt";
import { reservedMargin } from "@/lib/account";
import { priceInput as toPrice, triggerValues, editablePrice } from "@/lib/triggers";
import { payFromChain } from "@/lib/intents";
import { useRevengeFlash, useStreak } from "./Streaks";
import { Burst, Gauge, MoodGlow, useCloseFx, useMood, useTensionSound } from "./Mood";
import { ActivityList, useActivity } from "./Activity";
import { HistoryList } from "./History";
import { ShareButton, type CardData } from "./PnlCard";
import { Jackpot, fmtDuration } from "./Jackpot";
import { useHistory } from "./History";

/** Chart windows: the app keeps up to 30 minutes of prices it has seen. */
const RANGES = [
  ["1m", 60_000],
  ["5m", 300_000],
  ["30m", 1_800_000],
] as const;

const MIN_HOLD_S = 60;

/**
 * The bar above the chart: the market (a pill that opens the list of markets), a strip of what the house knows
 * about it (how its exposure splits between longs and shorts, the room left before trades are refused, the
 * leverage cap), the chart's style and window, and whether prices are live.
 */
function MarketBar(props: {
  market: string;
  setMarket: (m: string) => void;
  markets: Market[];
  held: Set<string>;
  style: "line" | "candles";
  setStyle: (s: "line" | "candles") => void;
  range: number;
  setRange: (r: number) => void;
}) {
  const { market, setMarket, markets, held, style, setStyle, range, setRange } = props;
  const { o, prices, history } = useOneUp();
  const solvency = usePoll(() => o.solvency(), [], 5000);
  const now = useNow();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  // change over the last 5 minutes, and the latest tick's direction
  const stat = (m: string) => {
    // over the chart's window, so the bar and the chart agree
    const h = (history[m] ?? []).filter((x) => x.t >= now * 1000 - range);
    const ch = h.length > 1 ? (h[h.length - 1].p / h[0].p - 1) * 100 : null;
    const down = h.length > 1 && h[h.length - 1].p < h[h.length - 2].p;
    return { h, ch, down };
  };
  const me = stat(market);
  const info = markets.find((m) => m.id === market);
  const long = info ? BigInt(info.long_liability) : 0n;
  const short = info ? BigInt(info.short_liability) : 0n;
  // whole percents that add up to 100
  const longPct = long + short > 0n ? Math.round(Number((long * 1000n) / (long + short)) / 10) : null;
  const sm = solvency?.markets.find((m) => m.id === market);
  const room = sm ? BigInt(sm.capacity) - BigInt(sm.liability) : null;
  const lastTick = (history[market] ?? []).at(-1)?.t ?? 0;
  const live = now * 1000 - lastTick < 5_000;
  const windowName = RANGES.find(([, ms]) => ms === range)?.[0] ?? "";
  const pct = (ch: number | null) => (ch === null ? "–" : `${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%`);
  const tone = (ch: number | null) => (ch === null ? "var(--muted)" : ch >= 0 ? "var(--long)" : "var(--short)");

  return (
    // desktop: market, stats, chart controls in one row; phones: market and controls, then the stats
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div ref={ref} className="relative min-w-0 flex-1 lg:flex-none">
        <button type="button" className="bar-pill num w-full lg:w-auto" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
          <b className="text-[15px] sm:text-base">{market.split("-")[0]}</b>
          <span className="bar-sep" aria-hidden />
          <span key={prices[market]?.toString()} className={`tick-flash truncate text-[15px] font-extrabold sm:text-base ${me.down ? "tick-down" : "tick-up"}`}>
            {prices[market] ? `$${fmtPrice(prices[market])}` : "…"}
          </span>
          <span className="ml-auto shrink-0 pl-1">
            <Icon name="chevron" size={16} />
          </span>
        </button>
        {open && (
          <ul role="listbox" aria-label="Market" className="panel absolute left-0 top-full z-30 mt-1.5 w-[min(400px,calc(100vw-32px))] p-1.5">
            {markets.map((m) => {
              const st = stat(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={m.id === market}
                    onClick={() => {
                      setMarket(m.id);
                      setOpen(false);
                    }}
                    className="num flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--panel-2)] aria-selected:bg-[var(--panel-2)]"
                  >
                    <span className="w-24 shrink-0 whitespace-nowrap">
                      <b>{m.id.split("-")[0]}</b>
                      <span className="text-[var(--muted)]">-{m.id.split("-")[1]}</span>
                    </span>
                    <span className="flex-1 font-bold">{prices[m.id] ? fmtPrice(prices[m.id]) : "…"}</span>
                    <span className="hidden sm:block">
                      <Sparkline points={st.h} color={tone(st.ch)} />
                    </span>
                    <span className="w-16 text-right text-sm font-bold" style={{ color: tone(st.ch) }}>
                      {pct(st.ch)}
                    </span>
                    <span className="w-2">{held.has(m.id) && <span className="block h-2 w-2 rounded-full bg-[var(--primary)]" aria-label="You have a position here" />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {/* the market's numbers, each named above its value as a trading terminal prints them */}
      <dl className="mkt-stats num order-3 w-full lg:order-2 lg:w-auto" aria-label={`${market} stats`}>
        <div>
          <dt>Change, {windowName}</dt>
          <dd style={{ color: tone(me.ch) }}>{pct(me.ch)}</dd>
        </div>
        <div title="How the market's open max wins split between longs and shorts">
          <dt>Longs / shorts</dt>
          <dd>
            <span style={{ color: "var(--long)" }}>{longPct === null ? "–" : `${longPct.toFixed(0)}%`}</span>
            <span className="text-[var(--muted)]"> / </span>
            <span style={{ color: "var(--short)" }}>{longPct === null ? "–" : `${(100 - longPct).toFixed(0)}%`}</span>
          </dd>
        </div>
        <div title="How much more max win this market can take before new trades are refused">
          <dt>Room</dt>
          <dd>{room === null ? "…" : `$${fmtCompact(room)}`}</dd>
        </div>
        <div className="hidden sm:block">
          <dt>Max leverage</dt>
          <dd>{info ? `${info.max_leverage}×` : "…"}</dd>
        </div>
      </dl>
      {/* phones: a row of its own, so the market pill keeps its price */}
      <div className="bar-strip num order-2 w-full justify-between lg:order-3 lg:ml-auto lg:w-auto lg:justify-start" role="group" aria-label="Chart">
        {/* laid out, not folded into menus: one tap to switch, as on a trading screen */}
        <span className="bar-cell !px-1" role="group" aria-label="Chart style">
          {(["line", "candles"] as const).map((k) => (
            <button key={k} type="button" className="bar-opt" aria-pressed={style === k} onClick={() => setStyle(k)}>
              {k === "line" ? "Line" : "Candles"}
            </button>
          ))}
        </span>
        <span className="bar-cell !px-1" role="group" aria-label="Chart window">
          {RANGES.map(([name, ms]) => (
            <button key={name} type="button" className="bar-opt num" aria-pressed={range === ms} onClick={() => setRange(ms)}>
              {name}
            </button>
          ))}
        </span>
        <span className="bar-cell" title={live ? "Prices are updating" : "No new price for a few seconds"}>
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "live-dot" : ""}`} style={{ background: live ? "var(--long)" : "var(--muted)" }} />
          <b className="hidden text-xs sm:inline" style={{ color: live ? "var(--long)" : "var(--muted)" }}>
            {live ? "Live" : "Paused"}
          </b>
        </span>
      </div>
    </div>
  );
}

/** $1.2M, $854K, $950. */
function fmtCompact(units: bigint) {
  const v = Number(units) / 1e6;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0);
}

/** A market's last few minutes as a small line, for the market list. */
function Sparkline({ points, color }: { points: { t: number; p: number }[]; color: string }) {
  const W = 56;
  const H = 22;
  if (points.length < 2) return <svg width={W} height={H} aria-hidden />;
  const lo = Math.min(...points.map((x) => x.p));
  const hi = Math.max(...points.map((x) => x.p));
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const d = points
    .map((x, i) => `${i ? "L" : "M"}${(((x.t - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)} ${(H - 2 - ((x.p - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={W} height={H} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** The chart's window: 1 minute unless you've picked another, remembered in this browser. */
function useChartRange(): [number, (r: number) => void] {
  const [range, set] = useState<number>(RANGES[0][1]);
  useEffect(() => {
    try {
      const r = Number(localStorage.getItem("oneup.range"));
      if (RANGES.some(([, ms]) => ms === r)) set(r);
    } catch {}
  }, []);
  return [
    range,
    (r) => {
      set(r);
      try {
        localStorage.setItem("oneup.range", String(r));
      } catch {}
    },
  ];
}

/** Line or candles, remembered in this browser. */
function useChartStyle(): ["line" | "candles", (s: "line" | "candles") => void] {
  const [style, set] = useState<"line" | "candles">("line");
  useEffect(() => {
    try {
      if (localStorage.getItem("oneup.chart") === "candles") set("candles");
    } catch {}
  }, []);
  return [
    style,
    (s) => {
      set(s);
      try {
        localStorage.setItem("oneup.chart", s);
      } catch {}
    },
  ];
}

export function Trade() {
  const { o, me, prices } = useOneUp();
  const markets = usePoll(() => o.markets(), [], 5000) ?? [];
  const [market, setMarketState] = useState("NEAR-USD");
  const positions = usePoll(() => o.positions(me), [me]) ?? [];
  // until you pick a market or a position, the chart follows your top position
  const chose = useRef(false);
  const setMarket = (m: string) => {
    chose.current = true;
    setMarketState(m);
  };
  const top = positions[0];
  useEffect(() => {
    if (!chose.current && top && top.market_id !== market) setMarketState(top.market_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id]);
  const orders = usePoll(() => o.orders(me), [me]) ?? [];
  const ticket = useTicket(market, markets.find((m) => m.id === market)?.max_leverage ?? 100);
  // the phone trade bar only shows while the form itself is scrolled away
  const formRef = useRef<HTMLDivElement>(null);
  const [formVisible, setFormVisible] = useState(true);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setFormVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // the chart details one position: the one picked below, or the top one in this market; the rest show faintly
  const [focus, setFocus] = useState<number | null>(null);
  useEffect(() => {
    chose.current = false;
    setFocus(null);
  }, [me]);
  const here = positions.filter((p) => p.market_id === market);
  const focused = here.find((p) => p.id === focus) ?? here[0];
  const pick = (p: Position) => {
    setFocus(p.id);
    setMarket(p.market_id);
    document.getElementById("chart")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const mark = prices[market];
  const marks: Mark[] = here.flatMap((p): Mark[] => {
    const entry = BigInt(p.entry_price);
    if (p !== focused) return [{ price: priceToNumber(entry), label: `#${p.id} entry`, kind: "entry", pos: p.id, faint: true }];
    const margin = BigInt(p.margin);
    // what closing now would pay
    const net = mark ? afterCut(pnl(p.side, margin, p.leverage, entry, mark), p.cut_ppm) : null;
    return [
      {
        price: priceToNumber(entry),
        label: `#${p.id} entry`,
        kind: "entry",
        pos: p.id,
        pnl: net === null ? undefined : { usd: Number(net) / 1e6, pct: (Number(net) / Number(margin)) * 100 },
        // the price of the 9× profit cap: a move of 9 ÷ leverage
        cap: priceToNumber(entry) * (1 + ((p.side === "Long" ? 1 : -1) * 9) / p.leverage),
        since: p.opened_at * 1000,
      },
      { price: priceToNumber(liquidationPrice(p.side, entry, p.leverage)), label: `#${p.id} liq`, kind: "liq", pos: p.id },
      ...(p.triggers.take_profit ? [{ price: priceToNumber(BigInt(p.triggers.take_profit)), label: `#${p.id} TP`, kind: "tp" as const, pos: p.id }] : []),
      ...(p.triggers.stop_loss ? [{ price: priceToNumber(BigInt(p.triggers.stop_loss)), label: `#${p.id} SL`, kind: "sl" as const, pos: p.id }] : []),
    ];
  });

  return (
    // Phones: one column in the order banner, chart, order form, then positions and activity (the left column
    // dissolves via `contents` and `order` interleaves them), with a trade bar while the form is out of view.
    // Desktop: chart over positions and activity on the left, the form on the right.
    <div className="flex flex-col gap-4 pb-24 lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:pb-0 2xl:grid-cols-[1fr_380px]">
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        <div className="order-1 empty:hidden">
          <LossBanner />
        </div>
        {/* very wide screens: the market's trades run beside the chart, where an exchange keeps its book */}
        <div className="contents 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_250px] 2xl:gap-4">
          <Console
            market={market}
            setMarket={setMarket}
            markets={markets.filter((m) => m.live)}
            marks={marks}
            mine={focused ? [focused] : []}
            held={new Set(positions.map((p) => p.market_id))}
          />
          <TradesTape market={market} info={markets.find((m) => m.id === market)} />
        </div>
        <div className="order-4 min-w-0">
          <Below positions={positions} orders={orders} focused={focused?.id} pick={pick} market={market} />
        </div>
      </div>
      <div ref={formRef} id="order-form" className="order-3 flex flex-col gap-4">
        <OrderForm t={ticket} />
        <Account t={ticket} positions={positions} orders={orders} />
        {/* under the form on every screen: on a desktop it fills the column beside the tall chart */}
        <Jackpot compact />
      </div>
      {!formVisible && <TradeBar t={ticket} />}
    </div>
  );
}

/** What you hold, as an exchange's account box sums it: your wallet, your balance in OneUp, the margin your
 *  positions and pending opens lock up and what positions would pay if closed now. */
function Account({ t, positions, orders }: { t: Ticket; positions: Position[]; orders: Order[] }) {
  const { prices } = useOneUp();
  const margin = reservedMargin(positions, orders);
  const open = positions.reduce((a, p) => {
    const mark = prices[p.market_id];
    return mark ? a + afterCut(pnl(p.side, BigInt(p.margin), p.leverage, BigInt(p.entry_price), mark), p.cut_ppm) : a;
  }, 0n);
  const equity = t.wallet + t.free + margin + open;
  const usd = (x: bigint) => `${x < 0n ? "−" : ""}$${fmtUsdc(x < 0n ? -x : x, (x < 0n ? -x : x) < 1_000n * USDC ? 2 : 0)}`;
  return (
    <section className="panel p-4" aria-label="Account">
      <div className="ticket-row">
        <h3 className="font-extrabold">Account</h3>
        <span className="num text-lg font-extrabold" title="Wallet, balance in OneUp, reserved order margin, and positions at the current mark">
          {usd(equity)}
        </span>
      </div>
      <dl className="num mt-2 flex flex-col gap-1.5 text-sm">
        <div className="ticket-row">
          <dt className="label">Wallet</dt>
          <dd className="font-bold">{usd(t.wallet)}</dd>
        </div>
        <div className="ticket-row">
          <dt className="label">In OneUp</dt>
          <dd className="font-bold">{usd(t.free)}</dd>
        </div>
        <div className="ticket-row">
          <dt className="label">Margin in use</dt>
          <dd className="font-bold">{usd(margin)}</dd>
        </div>
        <div className="ticket-row">
          <dt className="label">Open PnL</dt>
          <dd className="font-bold" style={{ color: open > 0n ? "var(--long)" : open < 0n ? "var(--short)" : undefined }}>
            {open > 0n ? "+" : ""}
            {usd(open)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** How long a trade arriving on the tape flashes (its animation in globals.css runs this long). */
const FLASH_MS = 1100;

/** How long ago, in the tape's few characters. */
const agoShort = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

/** The market's trades as they happen, newest first, under how its open max wins split between longs and shorts. */
function TradesTape({ market, info }: { market: string; info?: Market }) {
  const feed = useActivity(300);
  const now = useNow();
  const rows = feed.filter((a) => a.trade?.market === market).slice(0, 40);
  // trades that arrive while you watch flash in, for FLASH_MS from when they first showed; the first batch the
  // tape (or a newly picked market) loads is already history and doesn't
  const seen = useRef<{ market: string; at: Map<number, number> } | null>(null);
  const t = Date.now();
  if (rows.length && (!seen.current || seen.current.market !== market)) seen.current = { market, at: new Map(rows.map((a) => [a.seq, 0])) };
  else if (seen.current) for (const a of rows) if (!seen.current.at.has(a.seq)) seen.current.at.set(a.seq, t);
  const fresh = (seq: number) => t - (seen.current?.at.get(seq) ?? 0) < FLASH_MS;
  const long = info ? BigInt(info.long_liability) : 0n;
  const short = info ? BigInt(info.short_liability) : 0n;
  // whole percents that add up to 100
  const longPct = long + short > 0n ? Math.round(Number((long * 1000n) / (long + short)) / 10) : 50;
  return (
    <section className="panel tape order-2 hidden min-h-0 flex-col 2xl:flex" aria-label={`${market} trades`}>
      <div className="flex items-baseline justify-between px-3.5 pt-3">
        <h3 className="flex items-center gap-1.5 font-extrabold">
          Trades
          <span className="text-[var(--muted)]" title="Green is a long, red a short; × marks a close." aria-label="Green is a long, red a short; × marks a close.">
            <Icon name="info" size={14} />
          </span>
        </h3>
        <span className="label">{market}</span>
      </div>
      {/* the house's book on this market: whose max wins it holds more of */}
      <div className="px-3.5 pt-2.5" title="How the market's open max wins split between longs and shorts">
        <div className="tape-split num">
          <span style={{ width: `${longPct}%` }}>L {longPct.toFixed(0)}%</span>
          <span style={{ width: `${100 - longPct}%` }}>{(100 - longPct).toFixed(0)}% S</span>
        </div>
      </div>
      <div className="tape-row label mt-3 px-3.5 pb-1">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>
      <ol className="num min-h-0 flex-1 overflow-y-auto px-3.5 pb-3 text-[13px]">
        {rows.length === 0 && <li className="label py-2">No trades on {market} yet.</li>}
        {rows.map((a) => {
          const tr = a.trade!;
          return (
            <li
              key={a.seq}
              className={`tape-row border-b border-[var(--line)]/50 py-[5px] last:border-0 ${fresh(a.seq) ? "tape-new" : ""}`}
              style={{ "--flash": tr.side === "Long" ? "var(--long)" : "var(--short)" } as React.CSSProperties}
              title={a.text}
            >
              <span className="font-bold" style={{ color: tr.side === "Long" ? "var(--long)" : "var(--short)", opacity: tr.open ? 1 : 0.6 }}>
                {tr.open ? "" : "× "}
                {fmtPrice(BigInt(tr.price))}
              </span>
              <span className="text-right">${fmtCompact(BigInt(tr.size))}</span>
              <span className="label text-right">{agoShort(now * 1000 - a.t)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Positions and the live feed share one panel, switched by tabs. */
function Below({ positions: all, orders, focused, pick, market }: { positions: Position[]; orders: Order[]; focused?: number; pick: (p: Position) => void; market: string }) {
  const [view, setView] = useState<"positions" | "history" | "activity">("positions");
  const feed = useActivity().filter((a) => a.kind !== "opened");
  const [onlyHere, setOnlyHere] = useState(false);
  const positions = onlyHere ? all.filter((p) => p.market_id === market) : all;
  return (
    <div className="panel p-4 pt-2">
      <div className="tabs-inline mb-2 flex items-center justify-between border-b border-[var(--line)]" role="tablist">
        <div className="flex gap-1">
          {(
            [
              ["positions", `Positions${all.length ? ` (${all.length})` : ""}`],
              ["history", "History"],
              ["activity", "Activity"],
            ] as const
          ).map(([k, name]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className="tab">
              {name}
            </button>
          ))}
        </div>
        {view === "activity" && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--long)]">
            <span className="h-2 w-2 rounded-full bg-[var(--long)]" aria-hidden /> on chain
          </span>
        )}
        {view === "positions" && all.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="hidden cursor-pointer items-center gap-1.5 text-xs font-bold text-[var(--muted)] sm:flex">
              <input type="checkbox" className="check" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} />
              {market} only
            </label>
            <CloseAll positions={positions} />
          </div>
        )}
      </div>
      {view === "positions" && <Positions positions={positions} orders={orders} focused={focused} pick={pick} />}
      {view === "history" && <HistoryList />}
      {view === "activity" && <ActivityList items={feed} />}
    </div>
  );
}

type Ticket = ReturnType<typeof useTicket>;

/** The order ticket's state and what it would do, shared by the form and the phone trade bar. */
function useTicket(market: string, maxLeverage: number) {
  const { o, d, tx, run, prices, me, main, mainKey } = useOneUp();
  // where the margin comes from: the wallet's USDC on NEAR, or a bridged asset via NEAR Intents (D-21)
  const [payWith, setPayWith] = useState("wallet");
  const [intentStep, setIntentStep] = useState<string | null>(null);
  const viaAsset = d.intents?.assets.find((a) => a.token === payWith);
  const [side, setSide] = useState<Side>("Long");
  // D-30: a market order fills at the next price; a limit rests until the price reaches it
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [margin, setMargin] = useState("500");
  const [leverage, setLeverage] = useState(50);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  // trigger prices belong to one market and side: clear them when either changes
  useEffect(() => {
    setTp("");
    setSl("");
  }, [market, side]);
  const m = parseTokenAmount(margin, 6);
  const price = prices[market];
  const limitAt = orderType === "limit" ? toPrice(limitPrice) : null;
  // a limit's liquidation and the like are quoted from its limit price, where it would fill
  const at = limitAt ?? price;
  const quote = usePoll(() => o.quoteOpen(market, side, m, leverage, at), [market, side, margin, leverage, at?.toString()]);
  const free = BigInt(usePoll(() => o.balance(me), [me]) ?? "0");
  const wallet = BigInt(usePoll(() => o.usdcBalance(me), [me]) ?? "0");
  const pool = BigInt(usePoll(() => o.pool(), []) ?? "0");
  // short of free balance: top up from the wallet in the same transaction
  const topUp = m > free ? m - free : 0n;
  const tpAt = toPrice(tp);
  const slAt = toPrice(sl);
  // a trigger already past the price would fire on the first price after the hold: refuse it here
  const badTrigger = !!price && ((!!tpAt && targetHit(side, price, tpAt)) || (!!slAt && stopHit(side, price, slAt)));
  const blocked =
    !triggerValues(tp, sl) || !quote?.allowed || m === 0n || (!viaAsset && topUp > wallet) || badTrigger || intentStep !== null || (orderType === "limit" && (!limitAt || !!viaAsset));
  const label = viaAsset
    ? `${side} ${market} with ${viaAsset.symbol} on ${viaAsset.chain}`
    : orderType === "limit"
      ? `${topUp > 0n ? "Deposit & " : ""}Limit ${side.toLowerCase()} at ${limitAt ? fmtPrice(limitAt) : "…"}`
      : `${topUp > 0n ? "Deposit & " : ""}${side} ${market.split("-")[0]}`;
  const triggers = { takeProfit: tpAt, stopLoss: slAt };
  const submit = () =>
    viaAsset
      ? run(`${side} ${market} ${leverage}× · $${margin} via NEAR Intents`, () =>
          payFromChain({
            o,
            d,
            main,
            keyString: mainKey,
            asset: viaAsset,
            usdc: m,
            then: { kind: "open", market_id: market, side, margin: m, leverage, ...triggers },
            onStep: setIntentStep,
          }).finally(() => setIntentStep(null)),
        )
      : limitAt
        ? run(`Limit ${side.toLowerCase()} ${market} ${leverage}× · $${margin} at ${fmtPrice(limitAt)}`, () =>
            topUp > 0n ? tx.depositAndOpen(topUp, market, side, m, leverage, triggers, limitAt) : tx.placeLimitOpen(market, side, m, leverage, limitAt, triggers),
          )
        : run(`${side} ${market} ${leverage}× · $${margin}`, () =>
            topUp > 0n ? tx.depositAndOpen(topUp, market, side, m, leverage, triggers) : tx.placeOpen(market, side, m, leverage, triggers),
          );
  return { market, maxLeverage, side, setSide, orderType, setOrderType, limitPrice, setLimitPrice, limitAt, margin, setMargin, leverage, setLeverage, tp, setTp, sl, setSl, price, m, quote, free, wallet, pool, topUp, blocked, label, submit, payWith, setPayWith, viaAsset, intentStep };
}

/** The handheld: plastic case, slate surround with stripes, the LCD with its readout, and the market buttons. */
function Console({
  market,
  setMarket,
  markets,
  marks,
  mine,
  held: positionsHere,
}: {
  market: string;
  setMarket: (m: string) => void;
  markets: Market[];
  marks: Mark[];
  mine: Position[];
  /** Markets you have a position in. */
  held: Set<string>;
}) {
  const { prices, history, me, o, tx, run } = useOneUp();
  const mood = useMood(mine, prices[market]);
  const tilt = useTilt(me);
  useTensionSound(mood);
  const fx = useCloseFx(market);
  const revenge = useRevengeFlash();
  const streak = useStreak(me);
  const [range, setRange] = useChartRange();
  const [style, setStyle] = useChartStyle();
  const now = useNow();
  // with no position on the chart, its top row shows the jackpot
  const { o: one, d: dep } = useOneUp();
  const treasury = usePoll(() => one.treasury(), [], 5000);
  const ep = usePoll(() => one.epoch(), [], 10_000);
  const drawIn = treasury && ep ? Math.max(0, (treasury.draw_epoch - ep.id) * dep.epochLengthS + ep.started_at + dep.epochLengthS - now) : null;
  const jackpotLine =
    treasury?.vault && drawIn !== null ? (
      <span className="flex items-center gap-1.5 text-sm">
        {/* the coin turns faster in the last round before the draw */}
        <span className={`coin-spin ${drawIn < dep.epochLengthS ? "fast" : ""}`} aria-hidden>
          <PixelCoin size={16} />
        </span>
        Jackpot ${fmtUsdc(BigInt(treasury.jackpot), 0)} · draws in {fmtDuration(drawIn)}
      </span>
    ) : undefined;
  // the window, plus the last price before it so the line runs in from the left edge
  const all = history[market] ?? [];
  const from = now * 1000 - range;
  const first = all.findIndex((p) => p.t >= from);
  const pts = first === -1 ? all.slice(-1) : all.slice(Math.max(0, first - 1));
  const change = pts.length > 1 ? (pts[pts.length - 1].p / pts[0].p - 1) * 100 : 0;
  // the position on the chart: drag its triggers there, and close or reverse it from its entry line
  const pos = mine[0];
  const mark = prices[market];
  const triggers = pos
    ? {
        check: (kind: "tp" | "sl", price: number) => chartTriggerCheck(pos, kind, price, mark),
        set: (kind: "tp" | "sl", price: number | null) => {
          const at = price === null ? null : numberToPrice(price);
          const keep = (x: string | null) => (x ? BigInt(x) : null);
          const name = kind === "tp" ? "take profit" : "stop loss";
          return run(`${at === null ? "Clear" : "Set"} ${name} on #${pos.id}`, () =>
            tx.setTriggers(pos.id, {
              takeProfit: kind === "tp" ? at : keep(pos.triggers.take_profit),
              stopLoss: kind === "sl" ? at : keep(pos.triggers.stop_loss),
            }),
          );
        },
      }
    : undefined;
  const hold = pos ? Math.max(0, pos.opened_at + MIN_HOLD_S - now) : 0;
  const reverse = () => {
    if (!pos) return;
    const other: Side = pos.side === "Long" ? "Short" : "Long";
    const margin = BigInt(pos.margin);
    run(`Reverse #${pos.id} to ${other.toLowerCase()} ${pos.leverage}×`, async () => {
      await tx.placeClose(pos.id);
      // the close pays back when it fills, so the open's margin comes from the balance now, topped up from the wallet
      const free = BigInt(await o.balance(me));
      const top = margin > free ? margin - free : 0n;
      if (top > 0n) await tx.depositAndOpen(top, pos.market_id, other, margin, pos.leverage);
      else await tx.placeOpen(pos.market_id, other, margin, pos.leverage);
    });
  };
  const entryActions =
    pos && pos.close_order === null ? (
      <>
        <button type="button" disabled={hold > 0} onClick={() => run(`Close #${pos.id}`, () => tx.placeClose(pos.id))} title={hold > 0 ? "Positions are held at least a minute" : "Close at the next price"}>
          {hold > 0 ? `Close ${hold}s` : "Close"}
        </button>
        <button type="button" disabled={hold > 0} onClick={reverse} title={`Close, then open a ${pos.side === "Long" ? "short" : "long"} of the same size`}>
          Reverse
        </button>
      </>
    ) : undefined;
  return (
    <div key={fx?.kind === "liquidated" || (fx?.kind === "win" && fx.tier === 3) ? fx.id : "case"} id="chart" className={`case order-2 min-w-0 scroll-mt-4 p-3 sm:p-5 ${fx?.kind === "liquidated" || (fx?.kind === "win" && fx.tier === 3) ? "shake" : ""}`}>
      <MarketBar
        market={market}
        setMarket={setMarket}
        markets={markets}
        held={positionsHere}
        style={style}
        setStyle={setStyle}
        range={range}
        setRange={setRange}
      />
      <div className="bezel px-3 pb-5 pt-3 sm:px-5">
        <div className="faceplate mb-3" aria-hidden>
          <span className="stripes" />
          <span className="faceplate-print hidden sm:inline">LOSE A TRADE, GET A LIFE · NEAR HACKATHON 2026</span>
          <span className="stripes" />
        </div>
        <div className="relative">
          <PriceChart
            fill
            triggers={triggers}
            entryActions={entryActions}
            points={pts}
            span={range}
            candles={style === "candles"}
            marks={marks}
            alarm={mood.state === "danger" || mood.state === "critical"}
            readout={
              // the readout is printed on the screen, in LCD ink
              <span className="flex items-baseline gap-2">
                <span className="font-[family-name:var(--font-display)] text-base">{market}</span>
                {pts.length > 1 && (
                  <span className="text-sm">
                    {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% · {RANGES.find(([, ms]) => ms === range)?.[0]}
                  </span>
                )}
                {streak && streak.n >= 2 && (
                  <span className="text-sm" title={`${streak.n} ${streak.win ? "wins" : "losses"} in a row`}>
                    · {streak.win ? "W" : "L"}
                    {streak.n}
                  </span>
                )}
              </span>
            }
            gauge={mood.state !== "none" && mood.gauge ? <Gauge mood={mood} /> : jackpotLine}
          />
          <MoodGlow mood={mood} />
          {fx && <Burst fx={fx} />}
          {(revenge || tilt > 0) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status">
              {revenge ? (
                // a warning banner slammed across the screen
                // a fighting game's versus screen: you against the market, round two
                <span key={revenge} className="versus display" aria-label="Revenge trade">
                  <span className="versus-side you">
                    <span className="flex flex-col items-center gap-2.5">
                      <AngryHeart size={60} />
                      <span className="versus-name">YOU</span>
                    </span>
                  </span>
                  <span className="versus-side market">
                    <span className="flex flex-col items-center gap-2.5">
                      <FallingCandles size={60} />
                      <span className="versus-name">THE MARKET</span>
                    </span>
                  </span>
                  <span className="versus-vs">VS</span>
                  <span className="versus-call">
                    ROUND 2 <span className="versus-fight">FIGHT!</span>
                  </span>
                </span>
              ) : (
                // a pinball machine's TILT
                <span className="tilt display">
                  <span className="tilt-word">TILT</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

/** Leverage stops under the slider: the common picks, and where the track's log scale puts most of its length. */
const LEVERAGE_STOPS = [2, 10, 25, 50, 100, 500, 1000];
/** The leverage slider runs from 1× through each stop to the market's cap, the stops evenly spaced along it, and
 *  moves evenly between neighbouring stops: so 25×, 50× and 100× don't crowd together, and 500× and 1000× each
 *  get their own stretch. */
const anchors = (max: number) => [...new Set([1, ...LEVERAGE_STOPS.filter((x) => x < max), max])];
function levToPos(lev: number, max: number) {
  const a = anchors(max);
  const v = Math.max(1, Math.min(max, lev));
  const i = Math.max(0, a.findIndex((x, k) => v <= a[k + 1]));
  return ((i + (v - a[i]) / (a[i + 1] - a[i])) / (a.length - 1)) * 100;
}
function posToLev(pos: number, max: number) {
  const a = anchors(max);
  const f = (Math.max(0, Math.min(100, pos)) / 100) * (a.length - 1);
  const i = Math.min(a.length - 2, Math.floor(f));
  return Math.round(a[i] + (f - i) * (a[i + 1] - a[i]));
}

/**
 * The order ticket, laid out as on a trading terminal: side, what you can spend, margin, leverage on a slider,
 * triggers, the button, then what the order would do as label and value rows.
 */
function OrderForm({ t }: { t: Ticket }) {
  const { d } = useOneUp();
  const { side, setSide, margin, setMargin, leverage, setLeverage, maxLeverage, m, quote, free, wallet, pool, topUp, blocked, price } = t;
  const liq = quote?.liquidation_price ? BigInt(quote.liquidation_price) : null;
  // what a full loss would bring: an Extra Life of at most the loss × today's cap, and up to 20 $1UP per $1
  const lifeUpTo = owed(m, lifeCapPpm(pool));
  const oneupUpTo = Number(m / USDC) * Number(ONEUP_PER_USDC);
  // "Pay with" stays out of the way until it's wanted, or the wallet can't cover the trade
  const [payOpen, setPayWith] = useState(false);
  const showPayWith = payOpen || t.payWith !== "wallet" || topUp > wallet;
  const [why, setWhy] = useState(false);
  const spendable = free + wallet;
  const levPos = levToPos(leverage, maxLeverage);
  const hot = leverage >= 50;
  const marginRef = useRef<HTMLInputElement>(null);
  // desktop keys: L and S pick the side, [ and ] step the leverage stops, M goes to the margin; never while
  // typing, and Enter only places the order from the margin field, so a stray key can't trade
  useEffect(() => {
    const stops = LEVERAGE_STOPS.filter((x) => x <= maxLeverage);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k === "l") setSide("Long");
      else if (k === "s") setSide("Short");
      else if (k === "]") setLeverage(stops.find((x) => x > leverage) ?? stops[stops.length - 1]);
      else if (k === "[") setLeverage([...stops].reverse().find((x) => x < leverage) ?? stops[0]);
      else if (k === "m") marginRef.current?.select();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leverage, maxLeverage, setSide, setLeverage]);

  return (
    <div className="panel ticket flex flex-col gap-3.5 p-4">
      <div className="segmented" role="radiogroup" aria-label="Side">
        {(["Long", "Short"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            style={{
              "--seg": s === "Long" ? "var(--long)" : "var(--short)",
              "--seg-fill": s === "Long" ? "var(--long-fill)" : "var(--short-fill)",
            } as React.CSSProperties}
          >
            <Icon name={s === "Long" ? "up" : "down"} size={18} />
            {s}
          </button>
        ))}
      </div>

      {/* D-30: fill at the next price, or rest until the price reaches yours */}
      <div className="flex border-b border-[var(--line)]" role="tablist" aria-label="Order type">
        {(["market", "limit"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={t.orderType === k}
            className="ticket-tab"
            onClick={() => {
              t.setOrderType(k);
              // a new limit starts at the price, to nudge from
              if (k === "limit" && !t.limitPrice && price) t.setLimitPrice(String(priceToNumber(price)));
            }}
          >
            {k === "market" ? "Market" : "Limit"}
          </button>
        ))}
      </div>

      <div className="ticket-row">
        <span className="label">Available</span>
        <span className="num font-bold">${fmtUsdc(spendable, spendable < 1_000n * USDC ? 2 : 0)} USDC</span>
      </div>

      {t.orderType === "limit" && (
        <div className="flex flex-col gap-1">
          <span className="field">
            <span className="field-lead label">Price</span>
            <input
              className="input num text-right"
              value={t.limitPrice}
              onChange={(e) => t.setLimitPrice(e.target.value)}
              inputMode="decimal"
              aria-label="Limit price"
            />
            <span className="field-unit">USD</span>
          </span>
          <span className="label flex justify-between">
            <span>
              {side === "Long" ? "Fills at this price or lower" : "Fills at this price or higher"}
              {t.limitAt && price ? ` · ${away(price, t.limitAt)} from the price` : ""}
            </span>
            {price && (
              <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-[var(--text)]" onClick={() => t.setLimitPrice(String(priceToNumber(price)))}>
                Use price
              </button>
            )}
          </span>
          {t.viaAsset && <span className="text-sm text-[var(--short)]">A limit is paid from your USDC on NEAR, not another chain.</span>}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="field">
          <span className="field-lead label">Margin</span>
          <input
            ref={marginRef}
            className="input num text-right"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !blocked && t.submit()}
            inputMode="decimal"
            aria-label="Margin"
            aria-keyshortcuts="M"
          />
          <span className="field-unit">USDC</span>
        </span>
        <span className="chip-track" role="group" aria-label="Margin presets">
          {[50, 100, 500]
            .filter((x) => BigInt(x) * USDC <= spendable)
            .map((x) => (
              <button key={x} type="button" className="chip num flex-1 px-0" aria-pressed={margin === String(x)} onClick={() => setMargin(String(x))}>
                ${x}
              </button>
            ))}
          {spendable >= USDC && (
            <button
              type="button"
              className="chip num flex-1 px-0"
              aria-pressed={margin === String(Math.floor(Number(spendable / USDC)))}
              onClick={() => setMargin(String(Math.floor(Number(spendable / USDC))))}
            >
              Max
            </button>
          )}
        </span>
        {t.viaAsset && (
          <span className="label">
            Paid from {t.viaAsset.symbol} on {t.viaAsset.chain}: bridged, swapped and deposited in one intent
          </span>
        )}
      </div>

      {d.intents && showPayWith && (
        <label className="flex flex-col gap-1">
          <span className="label">Pay with</span>
          <select className="input" value={t.payWith} onChange={(e) => t.setPayWith(e.target.value)} aria-label="Pay with">
            <option value="wallet">USDC on NEAR (wallet)</option>
            {d.intents.assets.map((a) => (
              <option key={a.token} value={a.token}>
                {a.symbol} on {a.chain} · NEAR Intents
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-1">
        <div className="ticket-row">
          <span className="label">Leverage</span>
          <span className="lev-readout num" style={{ color: hot ? "var(--short)" : undefined }}>
            {leverage}×
          </span>
        </div>
        <input
          type="range"
          className="slider slider-steps"
          min={0}
          max={100}
          step={0.1}
          value={levPos}
          onChange={(e) => setLeverage(posToLev(Number(e.target.value), maxLeverage))}
          // the log track's small steps round back to the same leverage: the keys move a whole 1× (Page keys 10×)
          onKeyDown={(e) => {
            const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
            if (by === undefined) return;
            e.preventDefault();
            setLeverage(Math.max(1, Math.min(maxLeverage, leverage + by)));
          }}
          aria-label="Leverage"
          aria-valuetext={`${leverage}×`}
          style={{ "--fill": `${levPos}%`, ...(hot ? { "--primary": "var(--short)" } : {}) } as React.CSSProperties}
        />
        {/* the stops, each where it sits on the track */}
        <div className="relative h-5" role="group" aria-label="Leverage presets">
          {LEVERAGE_STOPS.filter((x) => x <= maxLeverage).map((x) => (
            <button
              key={x}
              type="button"
              className="lev-stop num"
              aria-pressed={leverage === x}
              style={{ left: `${levToPos(x, maxLeverage)}%`, "--at": levToPos(x, maxLeverage) / 100 } as React.CSSProperties}
              onClick={() => setLeverage(x)}
            >
              {x}×
            </button>
          ))}
        </div>
      </div>

      <TriggerFields side={side} entry={price} margin={m} leverage={leverage} liq={liq} tp={t.tp} setTp={t.setTp} sl={t.sl} setSl={t.setSl} />

      {quote && !quote.allowed && <p className="text-sm text-[var(--short)]">{quote.reason}</p>}
      {topUp > wallet && <p className="text-sm text-[var(--short)]">Not enough USDC in your wallet. Get some from the faucet in the Demo menu.</p>}

      <button
        className="btn btn-big"
        style={{ "--btn-bg": side === "Long" ? "var(--long-fill)" : "var(--short-fill)", color: "var(--on-fill)" } as React.CSSProperties}
        disabled={blocked}
        onClick={t.submit}
      >
        {!blocked && <Icon name={side === "Long" ? "up" : "down"} size={20} />}
        {t.label}
      </button>
      {t.intentStep && (
        <span className="label flex items-center gap-2" role="status">
          <Icon name="spinner" /> {t.intentStep}
        </span>
      )}

      {/* what the order would do, as a terminal lists it */}
      <dl className="num flex flex-col gap-1.5 border-t border-[var(--line)] pt-3 text-sm">
        <div className="ticket-row">
          <dt className="label">Liquidation price</dt>
          <dd className="font-bold">
            {liq ? fmtPrice(liq) : "…"}
            {liq && price && (
              <span className="font-normal" style={{ color: hot ? "var(--short)" : "var(--muted)" }}>
                {" "}
                ({away(price, liq)})
              </span>
            )}
          </dd>
        </div>
        <div className="ticket-row">
          <dt className="label">Position size</dt>
          <dd className="font-bold">${fmtUsdc(m * BigInt(leverage), 0)}</dd>
        </div>
        <div className="ticket-row">
          <dt className="label">You risk</dt>
          <dd className="font-bold">${fmtUsdc(m, 0)}</dd>
        </div>
        <div className="ticket-row">
          <dt className="label">Max win</dt>
          <dd className="font-bold" style={{ color: "var(--long)" }}>
            ${fmtUsdc(maxLiability(m), 0)}
          </dd>
        </div>
        <div className="ticket-row">
          <dt className="label">Winner&apos;s cut</dt>
          <dd className="font-bold">{quote ? `${(Number(quote.cut_ppm) / 1e4).toFixed(1)}%` : "…"}</dd>
        </div>
        <div className="ticket-row">
          <dt className="label">Fees</dt>
          <dd className="font-bold">None</dd>
        </div>
      </dl>

      {/* the promise, where the decision is made */}
      {m > 0n && (
        <div className="extra-life-note text-sm">
          <div className="flex items-center gap-2">
            <PixelHeart size={18} className="shrink-0" />
            <span className="min-w-0 flex-1">
              Lose it and get an Extra Life up to <b className="num">${fmtUsdc(lifeUpTo, 0)}</b> plus <b className="num">{oneupUpTo.toLocaleString("en-US")} $1UP</b>
            </span>
            <button type="button" className="label shrink-0 underline decoration-dotted underline-offset-2" aria-expanded={why} onClick={() => setWhy(!why)}>
              {why ? "Hide" : "How"}
            </button>
          </div>
          {why && (
            <p className="label mt-1.5">
              If this trade loses, you get an Extra Life that can pay back up to ${fmtUsdc(lifeUpTo, 0)} from house profit, plus up to{" "}
              {oneupUpTo.toLocaleString("en-US")} $1UP locked for 2 years, both sized from what the house makes this round, and a jackpot
              ticket for each $1 lost.
            </p>
          )}
        </div>
      )}

      <div className="label flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span>
          {t.viaAsset
            ? `Via NEAR Intents: a solver swaps your ${t.viaAsset.symbol} for USDC. Simulated on this local chain.`
            : t.orderType === "limit"
              ? "Rests until the price reaches it, for up to 24 hours. Cancel any time."
              : "Fills at the next oracle price."}
        </span>
        {/* the keys, where a keyboard is */}
        <span className="hidden w-full lg:block" aria-hidden>
          Keys: <kbd>L</kbd> <kbd>S</kbd> side · <kbd>[</kbd> <kbd>]</kbd> leverage · <kbd>M</kbd> margin, then <kbd>Enter</kbd>
        </span>
        {d.intents && !showPayWith && (
          <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-[var(--text)]" onClick={() => setPayWith(true)}>
            Pay from another chain
          </button>
        )}
      </div>
    </div>
  );
}

/** Phones: the ticket's main action stays in reach while you scroll the chart and positions. */
function TradeBar({ t }: { t: Ticket }) {
  return (
    <div className="fixed inset-x-0 bottom-[60px] z-30 border-t border-[var(--panel-edge)] bg-[var(--panel)] px-4 py-2.5 lg:hidden">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3">
        <a href="#order-form" className="num min-w-0 flex-1 text-sm">
          <span className="block truncate font-extrabold">
            {t.side} {t.leverage}× · ${t.margin}
          </span>
          <span className="label">Edit order</span>
        </a>
        <button
          className="btn shrink-0 px-5 py-2.5"
          style={{ "--btn-bg": t.side === "Long" ? "var(--long-fill)" : "var(--short-fill)", color: "var(--on-fill)" } as React.CSSProperties}
          disabled={t.blocked}
          onClick={t.submit}
        >
          <Icon name={t.side === "Long" ? "up" : "down"} />
          {t.topUp > 0n ? "Deposit & " : ""}
          {t.side}
        </button>
      </div>
    </div>
  );
}

/** A share card for an open position, at the current mark. */
const openCard = (p: Position, mark: bigint | undefined, v: bigint, me: string): CardData => ({
  market: p.market_id,
  side: p.side,
  leverage: p.leverage,
  margin: BigInt(p.margin),
  pnl: v,
  entry: BigInt(p.entry_price),
  exit: mark ?? BigInt(p.entry_price),
  state: "open",
  account: me,
});

/** `focused`: the position the chart details; `pick` shows another there. */
function Positions({ positions, orders, focused, pick }: { positions: Position[]; orders: Order[]; focused?: number; pick: (p: Position) => void }) {
  const { prices, me } = useOneUp();
  const now = useNow();
  const rows = useMemo(
    () =>
      positions.map((p) => {
        const mark = prices[p.market_id];
        // shown after the winner's cut: what closing now would pay
        const v = mark ? afterCut(pnl(p.side, BigInt(p.margin), p.leverage, BigInt(p.entry_price), mark), p.cut_ppm) : 0n;
        return { p, mark, v, hold: Math.max(0, p.opened_at + MIN_HOLD_S - now) };
      }),
    [positions, prices, now],
  );

  const pending = orders.filter((x) => "Open" in x.kind);
  return (
    <div>
      {rows.length === 0 && pending.length === 0 && <NoPositions />}
      <div className="flex flex-col md:hidden">
        {rows.map(({ p, mark, v, hold }) => (
          <div
            key={p.id}
            className="num -mx-2 cursor-pointer rounded-lg border-b border-[var(--line)] px-2 py-3 text-sm last:border-0"
            style={p.id === focused ? { background: "var(--panel-2)" } : undefined}
            onClick={(e) => !(e.target as Element).closest("button, a, input") && pick(p)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <ChartPick p={p} on={p.id === focused} pick={pick} />
              <div className="text-base font-semibold" style={{ color: v >= 0n ? "var(--long)" : "var(--short)" }}>
                {v >= 0n ? "+" : ""}
                {fmtUsdc(v)}
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-4 gap-x-2">
              <dt className="label">Size</dt>
              <dt className="label">Entry</dt>
              <dt className="label">Mark</dt>
              <dt className="label">Liq.</dt>
              <dd>${fmtUsdc(BigInt(p.margin) * BigInt(p.leverage), 0)}</dd>
              <dd>{fmtPrice(BigInt(p.entry_price))}</dd>
              <dd>{mark ? fmtPrice(mark) : "…"}</dd>
              <dd>
                {fmtPrice(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage))}
                {mark && <span className="label block">{away(mark, liquidationPrice(p.side, BigInt(p.entry_price), p.leverage))} away</span>}
              </dd>
            </dl>
            <div className="mt-2 flex items-center justify-between gap-2">
              <TriggerSummary p={p} />
              <EditTriggers key={JSON.stringify(p.triggers)} p={p} />
            </div>
            <div className="mt-3 flex gap-2">
              <div className="flex-1">
                <CloseButton p={p} hold={hold} wide />
              </div>
              <ShareButton data={() => openCard(p, mark, v, me)} />
            </div>
          </div>
        ))}
      </div>
      {rows.length > 0 && (
        <table className="num hidden w-full text-sm md:table">
          <thead>
            <tr className="label text-left">
              <th className="pb-2 font-normal">Market</th>
              <th className="pb-2 pr-4 text-right font-normal">Size</th>
              <th className="pb-2 pr-4 text-right font-normal">Entry</th>
              <th className="pb-2 pr-4 text-right font-normal">Mark</th>
              <th className="pb-2 pr-4 text-right font-normal">Liq.</th>
              <th className="pb-2 pl-2 font-normal">TP / SL</th>
              <th className="pb-2 text-right font-normal">PnL</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, mark, v, hold }) => (
              <tr
                key={p.id}
                className="cursor-pointer border-t border-[var(--line)]"
                style={p.id === focused ? { background: "var(--panel-2)" } : undefined}
                onClick={(e) => !(e.target as Element).closest("button, a, input") && pick(p)}
              >
                <td className="py-2.5 pl-1">
                  <ChartPick p={p} on={p.id === focused} pick={pick} />
                </td>
                <td className="pr-4 text-right">${fmtUsdc(BigInt(p.margin) * BigInt(p.leverage), 0)}</td>
                <td className="pr-4 text-right">{fmtPrice(BigInt(p.entry_price))}</td>
                <td className="pr-4 text-right">{mark ? fmtPrice(mark) : "…"}</td>
                <td className="py-2 pr-4 text-right">
                  {fmtPrice(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage))}
                  {mark && <span className="label block">{away(mark, liquidationPrice(p.side, BigInt(p.entry_price), p.leverage))} away</span>}
                </td>
                <td className="pl-2">
                  <span className="flex items-center gap-1">
                    <TriggerSummary p={p} />
                    <EditTriggers key={JSON.stringify(p.triggers)} p={p} />
                  </span>
                </td>
                <td className="text-right font-bold" style={{ color: v >= 0n ? "var(--long)" : "var(--short)" }}>
                  {v >= 0n ? "+" : "−"}${fmtUsdc(v >= 0n ? v : -v)}
                </td>
                <td className="pl-3 text-right">
                  <span className="inline-flex gap-2">
                    <ShareButton compact data={() => openCard(p, mark, v, me)} />
                    <CloseButton p={p} hold={hold} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pending.map((x) => (
        <PendingOpen key={x.id} x={x} />
      ))}
    </div>
  );
}

/** An open waiting for its fill: a market order for the next price, or a resting limit you can take down. */
function PendingOpen({ x }: { x: Order }) {
  const { tx, run, prices } = useOneUp();
  if (!("Open" in x.kind)) return null;
  const { side, leverage, margin, limit } = x.kind.Open;
  const what = `${side} ${x.market_id} ${leverage}× · $${fmtUsdc(BigInt(margin), 0)}`;
  if (!limit)
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-[var(--muted)]">
        <Icon name="spinner" />
        {what}: filling at the next oracle price
      </p>
    );
  const mark = prices[x.market_id];
  return (
    <div className="num mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-[var(--line)] px-3 py-2 text-sm">
      <span className="font-bold">Limit {what}</span>
      <span className="label">
        at {fmtPrice(BigInt(limit))}
        {mark ? ` · ${away(mark, BigInt(limit))} away` : ""} · resting
      </span>
      <button type="button" className="chip ml-auto !py-0.5 text-xs" onClick={() => run(`Cancel limit #${x.id}`, () => tx.cancelOrder(x.id))}>
        Cancel
      </button>
    </div>
  );
}

/** No open positions: your last few closed trades, so the panel isn't empty. */
function NoPositions() {
  const { me } = useOneUp();
  const h = useHistory(me);
  const trades = (h?.items ?? []).filter((i) => i.kind === "trade").slice(0, 3);
  return (
    <div className="py-2">
      <p className="label">No open positions. Pick a side and a size to open one.</p>
      {trades.length > 0 && (
        <>
          <p className="label mt-3">Your last trades</p>
          <ul className="num mt-1 flex flex-col text-sm">
            {trades.map((i) => {
              if (i.kind !== "trade") return null;
              const t = i.trade;
              const pnl = BigInt(t.pnl) - BigInt(t.cut ?? 0);
              return (
                <li key={i.seq} className="flex items-center justify-between gap-3 border-t border-[var(--line)] py-2 first:border-0">
                  <span>
                    <span style={{ color: t.side === "Long" ? "var(--long)" : "var(--short)" }}>{t.side}</span> {t.market_id} {t.leverage}×
                    {t.reason === "Liquidation" && <span className="label"> · liquidated</span>}
                  </span>
                  <b style={{ color: pnl >= 0n ? "var(--long)" : "var(--short)" }}>
                    {pnl >= 0n ? "+" : "−"}${fmtUsdc(pnl < 0n ? -pnl : pnl)}
                  </b>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** A position's name, which shows it on the chart; the one on the chart carries the chart icon. */
function ChartPick({ p, on, pick }: { p: Position; on: boolean; pick: (p: Position) => void }) {
  return (
    <button type="button" className="flex items-center gap-1.5 text-left font-semibold" aria-pressed={on} title={on ? "On the chart" : "Show on the chart"} onClick={() => pick(p)}>
      <span style={{ color: p.side === "Long" ? "var(--long)" : "var(--short)" }}>{p.side}</span> {p.market_id} {p.leverage}×
      <span className={on ? "text-[var(--primary)]" : "text-[var(--muted)] opacity-0"} aria-hidden>
        <Icon name="chart" size={14} />
      </span>
    </button>
  );
}

/** Close every position shown that's past its minimum hold, after a second tap to confirm. */
function CloseAll({ positions }: { positions: Position[] }) {
  const { tx, run } = useOneUp();
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const ready = positions.filter((p) => p.close_order === null && p.opened_at + MIN_HOLD_S <= now);
  useEffect(() => {
    if (!asking) return;
    // a confirm left alone goes away
    const t = setTimeout(() => setAsking(false), 5000);
    return () => clearTimeout(t);
  }, [asking]);
  if (ready.length === 0) return null;
  const label = ready.length === 1 ? "Close 1" : `Close all ${ready.length}`;
  return asking ? (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-bold" role="group" aria-label="Confirm close all">
      <span className="text-[var(--short)]">{label}?</span>
      <button
        type="button"
        className="chip !py-0.5"
        style={{ background: "var(--short-fill)", borderColor: "var(--short-fill)", color: "var(--on-fill)" }}
        onClick={() => {
          setAsking(false);
          run(`Close ${ready.length} position${ready.length === 1 ? "" : "s"}`, async () => {
            for (const p of ready) await tx.placeClose(p.id);
          });
        }}
      >
        Yes
      </button>
      <button type="button" className="chip !py-0.5" onClick={() => setAsking(false)}>
        No
      </button>
    </span>
  ) : (
    <button type="button" className="chip !py-0.5 whitespace-nowrap text-xs" onClick={() => setAsking(true)}>
      {ready.length === 1 ? "Close 1" : "Close all"}
      {/* the count where there's room for it */}
      {ready.length > 1 && <span className="hidden sm:inline"> {ready.length}</span>}
    </button>
  );
}

function CloseButton({ p, hold, wide }: { p: Position; hold: number; wide?: boolean }) {
  const { tx, run } = useOneUp();
  if (p.close_order !== null) return <div className={`label ${wide ? "py-2 text-center" : ""}`}>closing…</div>;
  return (
    <button
      className={`btn btn-ghost ${wide ? "w-full" : "py-1"}`}
      disabled={hold > 0}
      onClick={() => run(`Close #${p.id}`, () => tx.placeClose(p.id))}
    >
      {hold > 0 ? `Close in ${hold}s` : "Close"}
    </button>
  );
}

/** A position's profit after the winner's cut (which rounds up); a loss is unchanged. */
const afterCut = (v: bigint, cutPpm: string) => (v > 0n ? v - (v * BigInt(cutPpm) + PPM - 1n) / PPM : v);

/** How far the mark is from a price, as a percentage of the mark. */
const away = (mark: bigint, to: bigint) => `${((Math.abs(Number(to - mark)) / Number(mark)) * 100).toFixed(1)}%`;

/** Optional take-profit and stop-loss for a new order: prices, with what each would make or lose. */
function TriggerFields(props: {
  side: Side;
  entry?: bigint;
  margin: bigint;
  leverage: number;
  liq: bigint | null;
  tp: string;
  setTp: (x: string) => void;
  sl: string;
  setSl: (x: string) => void;
}) {
  const { side, entry, margin, leverage, liq, tp, setTp, sl, setSl } = props;
  const [open, setOpen] = useState(false);
  const on = open || !!tp || !!sl;
  const toggle = (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
      <input
        type="checkbox"
        className="check"
        checked={on}
        onChange={(e) => {
          setOpen(e.target.checked);
          if (!e.target.checked) {
            setTp("");
            setSl("");
          }
        }}
      />
      Take profit / stop loss
    </label>
  );
  if (!on) return toggle;
  return (
    <div className="flex flex-col gap-2">
      {toggle}
      <div className="grid grid-cols-2 gap-2">
        <TriggerInput label="Take profit" value={tp} set={setTp} hint={hint(side, entry, margin, leverage, tp, "tp", liq)} slider={{ side, entry, leverage, kind: "tp" }} />
        <TriggerInput label="Stop loss" value={sl} set={setSl} hint={hint(side, entry, margin, leverage, sl, "sl", liq)} slider={{ side, entry, leverage, kind: "sl" }} />
      </div>
      <p className="label">Slide to a gain or loss on your margin, or type a price. Closes at the first oracle price past it, after the 60 s minimum hold.</p>
    </div>
  );
}

type TriggerSlider = { side: Side; entry?: bigint; leverage: number; kind: "tp" | "sl" };

/** Slider ends, as % of margin: a win is capped at 9× margin, a loss is liquidated at 90%. */
const MAX_TP_PCT = 900;
const MAX_SL_PCT = 89;

/** The largest gain or loss (as % of margin) a trigger can be slid to, short of the price reaching zero. */
function sliderMax({ side, leverage, kind }: TriggerSlider) {
  const max = kind === "tp" ? MAX_TP_PCT : MAX_SL_PCT;
  const toZero = (side === "Long") === (kind === "sl") ? leverage * 100 - 1 : Infinity;
  return Math.min(max, toZero);
}

/** Take profit runs 0–900%, so it moves on a squared scale: the small targets most people set get most of the track. */
const toPct = (pos: number, s: TriggerSlider) => (s.kind === "tp" ? (pos / 100) ** 2 : pos / 100) * sliderMax(s);
const toPos = (pct: number, s: TriggerSlider) => {
  const f = Math.min(1, Math.max(0, pct / sliderMax(s)));
  return (s.kind === "tp" ? Math.sqrt(f) : f) * 100;
};

/** The price at which a position makes (tp) or loses (sl) `pct`% of its margin. */
function priceAtPct(pct: number, { side, entry, leverage, kind }: TriggerSlider) {
  const e = priceToNumber(entry!);
  const up = (side === "Long") === (kind === "tp");
  const v = e * (1 + ((up ? 1 : -1) * pct) / 100 / leverage);
  return v.toFixed(v < 10 ? 4 : v < 1000 ? 2 : 0);
}

/** How far `x` is from the entry, as % of margin in the trigger's direction (0 when blank or the wrong side). */
function pctAtPrice(x: string, { side, entry, leverage, kind }: TriggerSlider) {
  const at = Number(x);
  if (!(at > 0) || !entry) return 0;
  const up = (side === "Long") === (kind === "tp");
  const move = (at / priceToNumber(entry) - 1) * (up ? 1 : -1);
  return Math.max(0, move * leverage * 100);
}

function TriggerInput(props: { label: string; value: string; set: (x: string) => void; hint: { text: string; bad?: boolean } | null; slider?: TriggerSlider }) {
  const { label, value, set, hint, slider } = props;
  const pos = slider ? toPos(pctAtPrice(value, slider), slider) : 0;
  const color = slider?.kind === "tp" ? "var(--long)" : "var(--short)";
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label">{label}</span>
      <input className="input num" value={value} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder="Price" aria-label={`${label} price`} />
      {slider && (
        <input
          type="range"
          className="slider slider-steps"
          min={0}
          max={100}
          step={0.5}
          value={pos}
          disabled={!slider.entry}
          aria-label={`${label} as % of margin`}
          aria-valuetext={value ? `${pctAtPrice(value, slider).toFixed(0)}% of margin` : "Off"}
          onChange={(e) => {
            const pct = Math.round(toPct(Number(e.target.value), slider));
            set(pct > 0 && slider.entry ? priceAtPct(pct, slider) : "");
          }}
          style={{ "--fill": `${pos}%`, "--primary": color } as React.CSSProperties}
        />
      )}
      <span className="label num truncate" style={hint?.bad ? { color: "var(--short)" } : undefined}>
        {hint?.text ?? " "}
      </span>
    </label>
  );
}

/** What a trigger at `x` would make or lose from `entry`, or why it won't work. */
function hint(side: Side, entry: bigint | undefined, margin: bigint, leverage: number, x: string, kind: "tp" | "sl", liq: bigint | null) {
  const at = toPrice(x);
  if (!at || !entry || margin === 0n) return null;
  if (kind === "tp" && targetHit(side, entry, at)) return { text: `Must be ${side === "Long" ? "above" : "below"} the price`, bad: true };
  if (kind === "sl" && stopHit(side, entry, at)) return { text: `Must be ${side === "Long" ? "below" : "above"} the price`, bad: true };
  if (kind === "sl" && liq && stopHit(side, at, liq)) return { text: "Past liquidation", bad: true };
  const v = pnl(side, margin, leverage, entry, at);
  const capped = v > maxLiability(margin) ? maxLiability(margin) : v;
  const sign = capped >= 0n ? "+" : "−";
  return { text: `${sign}$${fmtUsdc(capped < 0n ? -capped : capped, 0)} (${sign}${Math.abs((Number(capped) / Number(margin)) * 100).toFixed(0)}%)` };
}

/** A trigger dragged on the chart: whether it can work from the current price, then what it makes or loses
 *  from the position's entry. */
function chartTriggerCheck(p: Position, kind: "tp" | "sl", price: number, mark: bigint | undefined) {
  const margin = BigInt(p.margin);
  const liq = liquidationPrice(p.side, BigInt(p.entry_price), p.leverage);
  const x = String(price);
  const now = hint(p.side, mark, margin, p.leverage, x, kind, liq);
  if (now?.bad) return now;
  // a take-profit under the entry (or a stop over it) is fine: it just closes at a smaller loss (or a profit)
  const v = pnl(p.side, margin, p.leverage, BigInt(p.entry_price), numberToPrice(price));
  const capped = v > maxLiability(margin) ? maxLiability(margin) : v;
  const sign = capped >= 0n ? "+" : "−";
  return { text: `${sign}$${fmtUsdc(capped < 0n ? -capped : capped, 0)} (${sign}${Math.abs((Number(capped) / Number(margin)) * 100).toFixed(0)}%)` };
}

function TriggerSummary({ p }: { p: Position }) {
  const { take_profit: tp, stop_loss: sl } = p.triggers;
  if (!tp && !sl) return <span className="label">–</span>;
  return (
    <span className="num text-xs leading-tight">
      {tp && <span className="block text-[var(--long)]">TP {fmtPrice(BigInt(tp))}</span>}
      {sl && <span className="block text-[var(--short)]">SL {fmtPrice(BigInt(sl))}</span>}
    </span>
  );
}

/** Set or clear an open position's take-profit and stop-loss. */
function EditTriggers({ p }: { p: Position }) {
  const { tx, run, prices } = useOneUp();
  const mark = prices[p.market_id];
  const show = editablePrice;
  const [tp, setTp] = useState(show(p.triggers.take_profit));
  const [sl, setSl] = useState(show(p.triggers.stop_loss));
  const margin = BigInt(p.margin);
  const edited = triggerValues(tp, sl);
  const liq = liquidationPrice(p.side, BigInt(p.entry_price), p.leverage);
  return (
    <Popover
      label="Edit take profit and stop loss"
      button={<Icon name="edit" size={14} />}
      small
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-extrabold">
            TP / SL · {p.side} {p.market_id} {p.leverage}×
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TriggerInput label="Take profit" value={tp} set={setTp} hint={hint(p.side, mark, margin, p.leverage, tp, "tp", liq)} slider={{ side: p.side, entry: mark, leverage: p.leverage, kind: "tp" }} />
            <TriggerInput label="Stop loss" value={sl} set={setSl} hint={hint(p.side, mark, margin, p.leverage, sl, "sl", liq)} slider={{ side: p.side, entry: mark, leverage: p.leverage, kind: "sl" }} />
          </div>
          <p className="label">Gains and losses shown from the current price. Fires on the next oracle price past it; blank clears.</p>
          <button
            className="btn btn-accent"
            disabled={!edited}
            onClick={() => edited && run(`Set TP / SL on #${p.id}`, () => tx.setTriggers(p.id, edited)).then(close)}
          >
            Save
          </button>
        </div>
      )}
    </Popover>
  );
}

export function fmtPrice(p: bigint) {
  const v = priceToNumber(p);
  // cents on BTC and ETH too: a $0.80 move matters at 50×
  const digits = v < 10 ? 4 : 2;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Shows the moment a loss turns into a pending Extra Life (liquidation or a losing close). */
function LossBanner() {
  const { o, d, me } = useOneUp();
  const pending = usePoll(() => o.pendingLife(me), [me]);
  const epoch = usePoll(() => o.epoch(), []);
  const now = useNow();
  const prev = useRef<{ me: string; v: bigint } | null>(null);
  const [loss, setLoss] = useState<{ amount: bigint; total: bigint } | null>(null);

  useEffect(() => {
    if (pending === undefined) return;
    const v = BigInt(pending);
    const p = prev.current;
    if (p && p.me === me && v > p.v) setLoss({ amount: v - p.v, total: v });
    if (p && (p.me !== me || v < p.v)) setLoss(null); // other account, or a new epoch
    prev.current = { me, v };
  }, [pending, me]);

  if (!loss) return null;
  const left = epoch ? Math.max(0, epoch.started_at + d.epochLengthS - now) : 0;
  return (
    <div className="panel flex items-center gap-4 p-4" role="status" style={{ borderColor: "var(--heart)" }}>
      {/* keyed by the running total so the pop replays on every new loss */}
      <span key={loss.total.toString()} className="relative shrink-0">
        <PixelHeart size={44} className="heart-pop" />
        <span className="display plus-one absolute -top-3 left-1/2 -translate-x-1/2 text-lg text-[var(--heart)]">+1</span>
      </span>
      <div className="flex-1">
        <div className="text-lg font-extrabold leading-tight">Extra Life incoming</div>
        <div className="label num mt-1">
          You lost ${fmtUsdc(loss.amount)} (${fmtUsdc(loss.total)} this round). Your Extra Life and $1UP lock mint
          when the round ends in {fmtClock(left)}, sized from what the house made.
        </div>
      </div>
      <button className="btn btn-ghost px-2.5" onClick={() => setLoss(null)} aria-label="Dismiss">
        <Icon name="x" />
      </button>
    </div>
  );
}
