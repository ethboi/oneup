"use client";

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
import { PixelHeart } from "./Pixel";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { useTilt } from "@/lib/tilt";
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
  const longPct = long + short > 0n ? Number((long * 1000n) / (long + short)) / 10 : null;
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
          <span className="ml-auto hidden pl-3 text-sm font-bold sm:inline" style={{ color: tone(me.ch) }}>
            {pct(me.ch)} <span className="label font-normal">· {windowName}</span>
          </span>
          <span className="ml-auto shrink-0 sm:ml-0">
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
      <div className="bar-strip num order-3 w-full lg:order-2 lg:w-auto" role="group" aria-label={`${market} stats`}>
        <span className="bar-cell" title="How the market's open max wins split between longs and shorts">
          <span className="label">Longs</span>
          <b style={{ color: "var(--long)" }}>{longPct === null ? "–" : `${longPct.toFixed(0)}%`}</b>
          <span className="label">Shorts</span>
          <b style={{ color: "var(--short)" }}>{longPct === null ? "–" : `${(100 - longPct).toFixed(0)}%`}</b>
        </span>
        <span className="bar-cell" title="How much more max win this market can take before new trades are refused">
          <span className="label">Room</span>
          <b>{room === null ? "…" : `$${fmtCompact(room)}`}</b>
        </span>
      </div>
      <div className="bar-strip num order-2 lg:order-3 lg:ml-auto" role="group" aria-label="Chart">
        <label className="bar-cell">
          <span className="sr-only">Chart style</span>
          <select className="bar-select" value={style} onChange={(e) => setStyle(e.target.value as "line" | "candles")}>
            <option value="line">Line</option>
            <option value="candles">Candles</option>
          </select>
        </label>
        <label className="bar-cell">
          <span className="sr-only">Chart window</span>
          <select className="bar-select num" value={range} onChange={(e) => setRange(Number(e.target.value))}>
            {RANGES.map(([name, ms]) => (
              <option key={name} value={ms}>
                {name}
              </option>
            ))}
          </select>
        </label>
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
    <div className="flex flex-col gap-4 pb-24 lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:pb-0">
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        <div className="order-1 empty:hidden">
          <LossBanner />
        </div>
        <Console
          market={market}
          setMarket={setMarket}
          markets={markets.filter((m) => m.live)}
          marks={marks}
          mine={focused ? [focused] : []}
          held={new Set(positions.map((p) => p.market_id))}
        />
        <div className="order-4 min-w-0">
          <Below positions={positions} orders={orders} focused={focused?.id} pick={pick} />
          <div className="mt-4 hidden lg:block">
            <Jackpot />
          </div>
        </div>
      </div>
      <div ref={formRef} id="order-form" className="order-3 flex flex-col gap-4">
        <OrderForm t={ticket} />
        <div className="lg:hidden">
          <Jackpot compact />
        </div>
      </div>
      {!formVisible && <TradeBar t={ticket} />}
    </div>
  );
}

/** Positions and the live feed share one panel, switched by tabs. */
function Below({ positions, orders, focused, pick }: { positions: Position[]; orders: Order[]; focused?: number; pick: (p: Position) => void }) {
  const [view, setView] = useState<"positions" | "history" | "activity">("positions");
  const feed = useActivity().filter((a) => a.kind !== "opened");
  return (
    <div className="panel p-4 pt-2">
      <div className="tabs-inline mb-2 flex items-center justify-between border-b border-[var(--line)]" role="tablist">
        <div className="flex gap-1">
          {(
            [
              ["positions", `Positions${positions.length ? ` (${positions.length})` : ""}`],
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
  const [margin, setMargin] = useState("500");
  const [leverage, setLeverage] = useState(50);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  // trigger prices belong to one market and side: clear them when either changes
  useEffect(() => {
    setTp("");
    setSl("");
  }, [market, side]);
  const m = BigInt(Math.floor(Number(margin) || 0)) * USDC;
  const price = prices[market];
  const quote = usePoll(() => o.quoteOpen(market, side, m, leverage, price), [market, side, margin, leverage, price?.toString()]);
  const free = BigInt(usePoll(() => o.balance(me), [me]) ?? "0");
  const wallet = BigInt(usePoll(() => o.usdcBalance(me), [me]) ?? "0");
  const pool = BigInt(usePoll(() => o.pool(), []) ?? "0");
  // short of free balance: top up from the wallet in the same transaction
  const topUp = m > free ? m - free : 0n;
  const tpAt = toPrice(tp);
  const slAt = toPrice(sl);
  // a trigger already past the price would fire on the first price after the hold: refuse it here
  const badTrigger = !!price && ((!!tpAt && targetHit(side, price, tpAt)) || (!!slAt && stopHit(side, price, slAt)));
  const blocked = !quote?.allowed || m === 0n || (!viaAsset && topUp > wallet) || badTrigger || intentStep !== null;
  const label = viaAsset
    ? `${side} ${market} with ${viaAsset.symbol} on ${viaAsset.chain}`
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
      : run(`${side} ${market} ${leverage}× · $${margin}`, () =>
          topUp > 0n ? tx.depositAndOpen(topUp, market, side, m, leverage, triggers) : tx.placeOpen(market, side, m, leverage, triggers),
        );
  return { market, maxLeverage, side, setSide, margin, setMargin, leverage, setLeverage, tp, setTp, sl, setSl, price, m, quote, free, wallet, pool, topUp, blocked, label, submit, payWith, setPayWith, viaAsset, intentStep };
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
  const { prices, history, me } = useOneUp();
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
      <span className="text-sm">
        Jackpot ${fmtUsdc(BigInt(treasury.jackpot), 0)} · draws in {fmtDuration(drawIn)}
      </span>
    ) : undefined;
  // the window, plus the last price before it so the line runs in from the left edge
  const all = history[market] ?? [];
  const from = now * 1000 - range;
  const first = all.findIndex((p) => p.t >= from);
  const pts = first === -1 ? all.slice(-1) : all.slice(Math.max(0, first - 1));
  const change = pts.length > 1 ? (pts[pts.length - 1].p / pts[0].p - 1) * 100 : 0;
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
          <span className="faceplate-print hidden sm:inline">DOT MATRIX WITH EXTRA LIVES</span>
          <span className="stripes" />
        </div>
        <div className="relative">
          <PriceChart
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
                <span key={revenge} className="revenge display">
                  REVENGE TRADE
                  <br />
                  DETECTED
                </span>
              ) : (
                <span className="tilt display">TILT</span>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

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
  // a loss of 90% of margin liquidates: the move against you that takes
  const liqMove = 90 / leverage;

  return (
    <div className="panel flex flex-col gap-4 p-4">
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

      <label className="flex flex-col gap-1">
        <span className="label">Margin</span>
        <span className="field">
          <input className="input num" value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" aria-label="Margin" />
          <span className="field-unit">USDC</span>
        </span>
        <span className="chip-track mt-1" role="group" aria-label="Margin presets">
          {[50, 100, 500]
            .filter((x) => BigInt(x) * USDC <= free + wallet)
            .map((x) => (
              <button key={x} type="button" className="chip num flex-1 px-0" aria-pressed={margin === String(x)} onClick={() => setMargin(String(x))}>
                ${x}
              </button>
            ))}
          {free + wallet >= USDC && (
            <button
              type="button"
              className="chip num flex-1 px-0"
              aria-pressed={margin === String(Math.floor(Number((free + wallet) / USDC)))}
              onClick={() => setMargin(String(Math.floor(Number((free + wallet) / USDC))))}
            >
              Max ${fmtCompact(free + wallet)}
            </button>
          )}
        </span>
        <span className="label num">
          {t.viaAsset
            ? `Paid from ${t.viaAsset.symbol} on ${t.viaAsset.chain}: bridged, swapped and deposited in one intent`
            : topUp > 0n
              ? `$${fmtUsdc(free, 0)} free + $${fmtUsdc(topUp, 0)} from your wallet in the same step`
              : `$${fmtUsdc(free, 0)} free to trade`}
        </span>
      </label>

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

      <label className="flex flex-col gap-1">
        <span className="label flex justify-between">
          <span>Leverage</span>
          <span className="num text-base font-extrabold" style={{ color: leverage >= 50 ? "var(--short)" : "var(--text)" }}>
            {leverage}×
          </span>
        </span>
        <input
          type="range"
          className="slider"
          min={1}
          max={maxLeverage}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          style={{ "--fill": `${((leverage - 1) / Math.max(1, maxLeverage - 1)) * 100}%` } as React.CSSProperties}
        />
        <span className="chip-track mt-1" role="group" aria-label="Leverage presets">
          {[2, 5, 10, 25, 50, 100]
            .filter((x) => x <= maxLeverage)
            .map((x) => (
              <button key={x} type="button" className="chip num flex-1 px-0" aria-pressed={leverage === x} onClick={() => setLeverage(x)}>
                {x}×
              </button>
            ))}
        </span>
        <span className="label num" style={leverage >= 50 ? { color: "var(--short)" } : undefined}>
          A {liqMove < 1 ? liqMove.toFixed(2) : liqMove.toFixed(1)}% move against you liquidates
        </span>
      </label>

      {/* what's at stake first, the details under it */}
      <div className="num flex flex-col rounded-xl bg-[var(--panel-2)] px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span>
            You risk <b>${fmtUsdc(m, 0)}</b>
          </span>
          <span>
            win up to <b style={{ color: "var(--long)" }}>${fmtUsdc(maxLiability(m), 0)}</b>
          </span>
        </div>
        <dl className="mt-1.5 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-2 text-sm">
          <div className="min-w-0">
            <dt className="label">Liquidation</dt>
            <dd className="truncate font-bold">
              {liq ? fmtPrice(liq) : "…"}
              {liq && price && <span className="label font-normal"> {away(price, liq)}</span>}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label">Winner&apos;s cut</dt>
            <dd className="font-bold">{quote ? `${(Number(quote.cut_ppm) / 1e4).toFixed(1)}%` : "…"}</dd>
          </div>
          <div className="min-w-0 text-right">
            <dt className="label">Size</dt>
            <dd className="font-bold">${fmtUsdc(m * BigInt(leverage), 0)}</dd>
          </div>
        </dl>
      </div>

      <TriggerFields side={side} entry={price} margin={m} leverage={leverage} liq={liq} tp={t.tp} setTp={t.setTp} sl={t.sl} setSl={t.setSl} />

      {/* the promise, where the decision is made */}
      {m > 0n && (
        <div className="border-t border-[var(--line)] pt-3 text-sm">
          <div className="flex items-center gap-2">
            <PixelHeart size={18} className="shrink-0" />
            <span className="num min-w-0 flex-1">
              Lose it → Extra Life up to <b>${fmtUsdc(lifeUpTo, 0)}</b> + <b>{oneupUpTo.toLocaleString("en-US")} $1UP</b> + jackpot tickets
            </span>
            <button type="button" className="label shrink-0 underline decoration-dotted underline-offset-2" aria-expanded={why} onClick={() => setWhy(!why)}>
              {why ? "Hide" : "How"}
            </button>
          </div>
          {why && (
            <p className="label mt-1.5">
              If this trade loses, you get an Extra Life that can pay back up to ${fmtUsdc(lifeUpTo, 0)} from house profit, plus up to{" "}
              {oneupUpTo.toLocaleString("en-US")} $1UP locked for 2 years. Both are sized from what the house makes this round.
            </p>
          )}
        </div>
      )}

      {quote && !quote.allowed && <p className="text-sm text-[var(--short)]">{quote.reason}</p>}
      {topUp > wallet && <p className="text-sm text-[var(--short)]">Not enough USDC in your wallet. Get some from the faucet in the Demo menu.</p>}

      <button
        className="btn btn-big mb-1"
        style={{ "--btn-bg": side === "Long" ? "var(--long-fill)" : "var(--short-fill)", color: "var(--on-fill)" } as React.CSSProperties}
        disabled={blocked}
        onClick={t.submit}
      >
        {!blocked && <Icon name={side === "Long" ? "up" : "down"} size={20} />}
        <span className="flex flex-col items-center leading-tight">
          {t.label}
          {m > 0n && (
            <span className="num text-xs font-bold opacity-85">
              ${fmtUsdc(m, 0)} at {leverage}×
            </span>
          )}
        </span>
      </button>
      {t.intentStep ? (
        <p className="label -mt-1 flex items-center justify-center gap-2" role="status">
          <Icon name="spinner" /> {t.intentStep}
        </p>
      ) : t.viaAsset ? (
        <p className="label -mt-1 text-center">
          Via NEAR Intents: a solver swaps your {t.viaAsset.symbol} for USDC on the Verifier. The bridge is simulated on this local chain.
        </p>
      ) : (
        <p className="label -mt-1 text-center">Fills at the next oracle price. No fees, no funding.</p>
      )}
      {d.intents && !showPayWith && (
        <button type="button" className="label -mt-1 self-center underline decoration-dotted underline-offset-2" onClick={() => setPayWith(true)}>
          Pay from another chain
        </button>
      )}


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
        <p key={x.id} className="mt-2 flex items-center gap-2 text-sm text-[var(--muted)]">
          <Icon name="spinner" />
          {"Open" in x.kind && `${x.kind.Open.side} ${x.market_id} ${x.kind.Open.leverage}×`}: filling at the next oracle price
        </p>
      ))}
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

/** A typed price ("5.42") in 1e8 units, or null when blank or not a positive number. */
const toPrice = (x: string) => (Number(x) > 0 ? numberToPrice(Number(x)) : null);

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
  if (!open && !tp && !sl) {
    return (
      <button type="button" className="chip self-start" onClick={() => setOpen(true)}>
        + Take profit / stop loss
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
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
          className="slider"
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
  const show = (x: string | null) => (x ? String(priceToNumber(BigInt(x))) : "");
  const [tp, setTp] = useState(show(p.triggers.take_profit));
  const [sl, setSl] = useState(show(p.triggers.stop_loss));
  const margin = BigInt(p.margin);
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
            onClick={() => run(`Set TP / SL on #${p.id}`, () => tx.setTriggers(p.id, { takeProfit: toPrice(tp), stopLoss: toPrice(sl) })).then(close)}
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
