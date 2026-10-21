"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ONEUP_PER_USDC,
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
import { ActivityList, useActivity } from "./Activity";
import { HistoryList } from "./History";
import { ShareButton, type CardData } from "./PnlCard";

/** Chart windows: the app keeps up to 30 minutes of prices it has seen. */
const RANGES = [
  ["1m", 60_000],
  ["5m", 300_000],
  ["30m", 1_800_000],
] as const;

const MIN_HOLD_S = 60;

export function Trade() {
  const { o, me } = useOneUp();
  const markets = usePoll(() => o.markets(), [], 5000) ?? [];
  const [market, setMarket] = useState("NEAR-USD");
  const positions = usePoll(() => o.positions(me), [me]) ?? [];
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

  const marks: Mark[] = positions
    .filter((p) => p.market_id === market)
    .flatMap((p) => [
      { price: priceToNumber(BigInt(p.entry_price)), label: `#${p.id} entry`, kind: "entry" as const },
      {
        price: priceToNumber(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage)),
        label: `#${p.id} liq`,
        kind: "liq" as const,
      },
    ]);

  return (
    // Phones: one column in the order banner, chart, order form, then positions and activity (the left column
    // dissolves via `contents` and `order` interleaves them), with a trade bar while the form is out of view.
    // Desktop: chart over positions and activity on the left, the form on the right.
    <div className="flex flex-col gap-4 pb-24 lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:pb-0">
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        <div className="order-1 empty:hidden">
          <LossBanner />
        </div>
        <Console market={market} setMarket={setMarket} markets={markets.filter((m) => m.live).map((m) => m.id)} marks={marks} />
        <div className="order-4 min-w-0">
          <Below positions={positions} orders={orders} />
        </div>
      </div>
      <div ref={formRef} id="order-form" className="order-3">
        <OrderForm t={ticket} />
      </div>
      {!formVisible && <TradeBar t={ticket} />}
    </div>
  );
}

/** Positions and the live feed share one panel, switched by tabs. */
function Below({ positions, orders }: { positions: Position[]; orders: Order[] }) {
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
      {view === "positions" && <Positions positions={positions} orders={orders} />}
      {view === "history" && <HistoryList />}
      {view === "activity" && <ActivityList items={feed} />}
    </div>
  );
}

type Ticket = ReturnType<typeof useTicket>;

/** The order ticket's state and what it would do, shared by the form and the phone trade bar. */
function useTicket(market: string, maxLeverage: number) {
  const { o, tx, run, prices, me } = useOneUp();
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
  const blocked = !quote?.allowed || m === 0n || topUp > wallet || badTrigger;
  const label = `${topUp > 0n ? `Deposit $${fmtUsdc(topUp, 0)} & ` : ""}${side} ${market}`;
  const triggers = { takeProfit: tpAt, stopLoss: slAt };
  const submit = () =>
    run(`${side} ${market} ${leverage}× · $${margin}`, () =>
      topUp > 0n ? tx.depositAndOpen(topUp, market, side, m, leverage, triggers) : tx.placeOpen(market, side, m, leverage, triggers),
    );
  return { market, maxLeverage, side, setSide, margin, setMargin, leverage, setLeverage, tp, setTp, sl, setSl, price, m, quote, free, wallet, pool, topUp, blocked, label, submit };
}

/** The handheld: plastic case, slate surround with stripes, the LCD with its readout, and the market buttons. */
function Console({ market, setMarket, markets, marks }: { market: string; setMarket: (m: string) => void; markets: string[]; marks: Mark[] }) {
  const { prices, history } = useOneUp();
  const [range, setRange] = useState<number>(RANGES[1][1]);
  const now = useNow();
  const pts = (history[market] ?? []).filter((p, i, a) => p.t >= now * 1000 - range || i === a.length - 1);
  const change = pts.length > 1 ? (pts[pts.length - 1].p / pts[0].p - 1) * 100 : 0;
  return (
    <div className="case order-2 min-w-0 p-3 sm:p-5">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
      <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 pt-0.5" role="group" aria-label="Market">
        {markets.map((m) => {
          const h = history[m] ?? [];
          const ch = h.length > 1 ? (h[h.length - 1].p / h[0].p - 1) * 100 : null;
          const [base, quote] = m.split("-");
          return (
            <button key={m} aria-pressed={m === market} onClick={() => setMarket(m)} className="market-tile num shrink-0">
              <span className="text-sm">
                <b>{base}</b>
                <span className="text-[var(--muted)]">-{quote}</span>
              </span>
              <span className="text-base font-extrabold">{prices[m] ? fmtPrice(prices[m]) : "…"}</span>
              <span className="text-xs font-bold" style={{ color: ch === null ? "var(--muted)" : ch >= 0 ? "var(--long)" : "var(--short)" }}>
                {ch === null ? "–" : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(2)}%`}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex shrink-0 gap-1 sm:pt-2" role="group" aria-label="Chart range">
        {RANGES.map(([name, ms]) => (
          <button key={name} type="button" className="chip num" aria-pressed={range === ms} onClick={() => setRange(ms)}>
            {name}
          </button>
        ))}
      </div>
      </div>
      <div className="bezel px-3 pb-5 pt-3 sm:px-5">
        <div className="stripes mb-3" aria-hidden />
        <div className="relative">
          <PriceChart points={pts} marks={marks} />
          {/* the readout is printed on the screen, in LCD ink */}
          <div className="display num pointer-events-none absolute left-3 top-2 flex items-baseline gap-2 text-[var(--lcd-ink)]">
            <span className="font-[family-name:var(--font-display)] text-base">{market}</span>
            {pts.length > 1 && (
              <span className="text-sm">
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

function OrderForm({ t }: { t: Ticket }) {
  const { side, setSide, margin, setMargin, leverage, setLeverage, maxLeverage, m, quote, free, wallet, pool, topUp, blocked, price } = t;
  const liq = quote?.liquidation_price ? BigInt(quote.liquidation_price) : null;
  // what a full loss would bring: an Extra Life of at most the loss × today's cap, and up to 20 $1UP per $1
  const lifeUpTo = owed(m, lifeCapPpm(pool));
  const oneupUpTo = Number(m / USDC) * Number(ONEUP_PER_USDC);

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Side">
        {(["Long", "Short"] as const).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            className="btn py-2 text-base"
            style={{
              "--btn-bg": side === s ? (s === "Long" ? "var(--long-fill)" : "var(--short-fill)") : "var(--field)",
              color: side === s ? "var(--on-fill)" : "var(--muted)",
            } as React.CSSProperties}
          >
            <Icon name={s === "Long" ? "up" : "down"} size={18} />
            {s}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="label flex items-center justify-between">
          <span>Margin</span>
          {free + wallet >= USDC && (
            <button type="button" className="chip" onClick={() => setMargin(String(Math.floor(Number((free + wallet) / USDC))))}>
              Max ${fmtUsdc(free + wallet, 0)}
            </button>
          )}
        </span>
        <span className="field">
          <input className="input num" value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" aria-label="Margin" />
          <span className="field-unit">USDC</span>
        </span>
        <span className="label num">
          {topUp > 0n
            ? `$${fmtUsdc(free, 0)} free + $${fmtUsdc(topUp, 0)} from your wallet in the same step`
            : `$${fmtUsdc(free, 0)} free to trade`}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="label flex justify-between">
          <span>Leverage</span>
          <span className="num text-base font-extrabold text-[var(--text)]">{leverage}×</span>
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
        <span className="flex flex-wrap gap-1.5" role="group" aria-label="Leverage presets">
          {[2, 5, 10, 25, 50, 100]
            .filter((x) => x <= maxLeverage)
            .map((x) => (
              <button key={x} type="button" className="chip num" aria-pressed={leverage === x} onClick={() => setLeverage(x)}>
                {x}×
              </button>
            ))}
        </span>
      </label>

      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="label">Position size</dt>
        <dd className="num text-right">${fmtUsdc(m * BigInt(leverage), 0)}</dd>
        <dt className="label">Max profit (9× margin)</dt>
        <dd className="num text-right">${fmtUsdc(maxLiability(m), 0)}</dd>
        <dt className="label">Winner&apos;s cut</dt>
        <dd className="num text-right">{quote ? `${(Number(quote.cut_ppm) / 1e4).toFixed(1)}%` : "…"}</dd>
        <dt className="label">Liquidation price</dt>
        <dd className="num text-right">
          {liq ? fmtPrice(liq) : "…"}
          {liq && price ? <span className="label"> ({away(price, liq)} away)</span> : null}
        </dd>
      </dl>

      <TriggerFields side={side} entry={price} margin={m} leverage={leverage} liq={liq} tp={t.tp} setTp={t.setTp} sl={t.sl} setSl={t.setSl} />

      {/* the promise, where the decision is made */}
      {m > 0n && (
        <div className="flex gap-3 border-t border-[var(--line)] pt-3 text-sm">
          <PixelHeart size={22} className="mt-0.5 shrink-0" />
          <p>
            <b>If it loses</b>, you get an Extra Life that can pay back up to <b className="num">${fmtUsdc(lifeUpTo, 0)}</b>, plus up to{" "}
            <b className="num">{oneupUpTo.toLocaleString("en-US")} $1UP</b> locked for 2 years. Both are sized from the house&apos;s profit.
          </p>
        </div>
      )}

      {quote && !quote.allowed && <p className="text-sm text-[var(--short)]">{quote.reason}</p>}
      {topUp > wallet && <p className="text-sm text-[var(--short)]">Not enough USDC in your wallet. Get some from the faucet in the Demo menu.</p>}

      <button
        className="btn py-3 text-base"
        style={{ "--btn-bg": side === "Long" ? "var(--long-fill)" : "var(--short-fill)", color: "var(--on-fill)" } as React.CSSProperties}
        disabled={blocked}
        onClick={t.submit}
      >
        {t.label}
      </button>
      <p className="label -mt-1 text-center">Fills at the next oracle price. No fees, no funding.</p>
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

function Positions({ positions, orders }: { positions: Position[]; orders: Order[] }) {
  const { prices, me } = useOneUp();
  const now = useNow();
  const rows = useMemo(
    () =>
      positions.map((p) => {
        const mark = prices[p.market_id];
        const v = mark ? pnl(p.side, BigInt(p.margin), p.leverage, BigInt(p.entry_price), mark) : 0n;
        return { p, mark, v, hold: Math.max(0, p.opened_at + MIN_HOLD_S - now) };
      }),
    [positions, prices, now],
  );

  const pending = orders.filter((x) => "Open" in x.kind);
  return (
    <div>
      {rows.length === 0 && pending.length === 0 && <p className="label py-2">No open positions. Pick a side and a size to open one.</p>}
      <div className="flex flex-col md:hidden">
        {rows.map(({ p, mark, v, hold }) => (
          <div key={p.id} className="num border-b border-[var(--line)] py-3 text-sm last:border-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold">
                <span style={{ color: p.side === "Long" ? "var(--long)" : "var(--short)" }}>{p.side}</span> {p.market_id}{" "}
                {p.leverage}×
              </div>
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
              <th className="pb-2 font-normal">Size</th>
              <th className="pb-2 font-normal">Entry</th>
              <th className="pb-2 font-normal">Mark</th>
              <th className="pb-2 font-normal">Liq.</th>
              <th className="pb-2 font-normal">TP / SL</th>
              <th className="pb-2 text-right font-normal">PnL</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, mark, v, hold }) => (
              <tr key={p.id} className="border-t border-[var(--line)]">
                <td className="py-2.5">
                  <span style={{ color: p.side === "Long" ? "var(--long)" : "var(--short)" }}>{p.side}</span> {p.market_id}{" "}
                  {p.leverage}×
                </td>
                <td>${fmtUsdc(BigInt(p.margin) * BigInt(p.leverage), 0)}</td>
                <td>{fmtPrice(BigInt(p.entry_price))}</td>
                <td>{mark ? fmtPrice(mark) : "…"}</td>
                <td>
                  {fmtPrice(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage))}
                  {mark && <span className="label block">{away(mark, liquidationPrice(p.side, BigInt(p.entry_price), p.leverage))} away</span>}
                </td>
                <td>
                  <span className="flex items-center gap-1">
                    <TriggerSummary p={p} />
                    <EditTriggers key={JSON.stringify(p.triggers)} p={p} />
                  </span>
                </td>
                <td className="text-right" style={{ color: v >= 0n ? "var(--long)" : "var(--short)" }}>
                  {v >= 0n ? "+" : ""}
                  {fmtUsdc(v)}
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
        <TriggerInput label="Take profit" value={tp} set={setTp} hint={hint(side, entry, margin, leverage, tp, "tp", liq)} />
        <TriggerInput label="Stop loss" value={sl} set={setSl} hint={hint(side, entry, margin, leverage, sl, "sl", liq)} />
      </div>
      <p className="label">Closes at the first oracle price past it, after the 60 s minimum hold.</p>
    </div>
  );
}

function TriggerInput({ label, value, set, hint }: { label: string; value: string; set: (x: string) => void; hint: { text: string; bad?: boolean } | null }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label">{label}</span>
      <input className="input num" value={value} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder="Price" aria-label={`${label} price`} />
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
            <TriggerInput label="Take profit" value={tp} set={setTp} hint={hint(p.side, mark, margin, p.leverage, tp, "tp", liq)} />
            <TriggerInput label="Stop loss" value={sl} set={setSl} hint={hint(p.side, mark, margin, p.leverage, sl, "sl", liq)} />
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
  const digits = v < 10 ? 4 : v < 1000 ? 2 : 0;
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
          You lost ${fmtUsdc(loss.amount)} (${fmtUsdc(loss.total)} this epoch). Your Extra Life and $1UP lock mint
          when the epoch ends in {fmtClock(left)}, sized from what the house made.
        </div>
      </div>
      <button className="btn btn-ghost px-2.5" onClick={() => setLoss(null)} aria-label="Dismiss">
        <Icon name="x" />
      </button>
    </div>
  );
}
