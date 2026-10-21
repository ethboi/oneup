"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  USDC,
  fmtUsdc,
  liquidationPrice,
  maxLiability,
  pnl,
  priceToNumber,
  type Order,
  type Position,
  type Side,
} from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { PriceChart, type Mark } from "./PriceChart";
import { fmtClock, useNow } from "./Header";
import { PixelHeart } from "./Pixel";

const MIN_HOLD_S = 60;

export function Trade() {
  const { o, me } = useOneUp();
  const markets = usePoll(() => o.markets(), [], 5000) ?? [];
  const [market, setMarket] = useState("NEAR-USD");
  const [side, setSide] = useState<Side>("Long");
  const positions = usePoll(() => o.positions(me), [me]) ?? [];
  const orders = usePoll(() => o.orders(me), [me]) ?? [];

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
    // Phones: one column in the order banner, chart, order form, positions (the left column dissolves via
    // `contents` and `order` interleaves the form). Desktop: chart and positions left, form right.
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        <div className="order-1 empty:hidden">
          <LossBanner />
        </div>
        <Console
          market={market}
          setMarket={setMarket}
          markets={markets.filter((m) => m.live).map((m) => m.id)}
          marks={marks}
          side={side}
          setSide={setSide}
        />
        <div className="order-4 min-w-0">
          <Positions positions={positions} orders={orders} />
        </div>
      </div>
      <OrderForm
        market={market}
        maxLeverage={markets.find((m) => m.id === market)?.max_leverage ?? 100}
        side={side}
        setSide={setSide}
      />
    </div>
  );
}

/**
 * The handheld: plastic case, slate surround with stripes and a power LED, the LCD, then the D-pad
 * (market) and the A/B buttons (Long/Short, shared with the order form), and the market buttons.
 */
function Console(props: { market: string; setMarket: (m: string) => void; markets: string[]; marks: Mark[]; side: Side; setSide: (s: Side) => void }) {
  const { market, setMarket, markets, marks, side, setSide } = props;
  const { prices, history } = useOneUp();
  const pts = history[market] ?? [];
  const change = pts.length > 1 ? (pts[pts.length - 1].p / pts[0].p - 1) * 100 : 0;
  const step = (d: number) => {
    if (markets.length === 0) return;
    const i = markets.indexOf(market);
    setMarket(markets[(i + d + markets.length) % markets.length]);
  };
  return (
    <div className="case order-2 min-w-0 p-3 sm:p-5">
      <div className="bezel px-3 pb-5 pt-3 sm:px-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="stripes w-6 sm:flex-1" aria-hidden />
          <span className="display text-[11px] italic tracking-wider whitespace-nowrap text-[#c6c8da] sm:text-xs">
            ORACLE PRICE MATRIX
          </span>
          <span className="stripes flex-1 sm:w-10 sm:flex-none" aria-hidden />
        </div>
        <div className="flex gap-3">
          <div className="hidden w-10 shrink-0 flex-col items-center pt-12 sm:flex" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff3b4e] shadow-[0_0_8px_#ff3b4e]" />
            <span className="display mt-1 text-[9px] text-[#c6c8da]">POWER</span>
          </div>
          <div className="relative min-w-0 flex-1">
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

      <div className="mt-3 flex items-center justify-between px-1">
        <span className="display text-2xl italic text-[var(--wordmark)]">OneUp</span>
        <span className="display num text-lg">{prices[market] ? fmtPrice(prices[market]) : "…"}</span>
      </div>

      <div className="mt-3 flex items-center justify-between px-1 sm:px-4">
        <DPad onStep={step} />
        <div className="hidden flex-1 flex-wrap justify-center gap-2 px-4 lg:flex" role="group" aria-label="Market">
          {markets.map((m) => (
            <button key={m} aria-pressed={m === market} onClick={() => setMarket(m)} className="bezel-btn num shrink-0 whitespace-nowrap">
              {m} {prices[m] ? fmtPrice(prices[m]) : ""}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-4 pr-1" role="radiogroup" aria-label="Side">
          {(
            [
              ["B", "Short", "mt-6"],
              ["A", "Long", ""],
            ] as const
          ).map(([key, s, offset]) => (
            <div key={key} className={`flex flex-col items-center gap-1.5 ${offset}`}>
              <button className="ab" role="radio" aria-checked={side === s} aria-pressed={side === s} aria-label={`${key}: ${s}`} onClick={() => setSide(s)}>
                {key}
              </button>
              <span className="display text-xs" style={{ color: side === s ? (s === "Long" ? "var(--long)" : "var(--short)") : "var(--wordmark)" }}>
                {s}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* phones: market buttons under the controls; desktop: between the D-pad and A/B */}
      <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 pt-0.5 lg:hidden" role="group" aria-label="Market">
          {markets.map((m) => (
            <button key={m} aria-pressed={m === market} onClick={() => setMarket(m)} className="bezel-btn num shrink-0 whitespace-nowrap">
              {m} {prices[m] ? fmtPrice(prices[m]) : ""}
            </button>
          ))}
        </div>
    </div>
  );
}

/** A cross-shaped D-pad: left/up for the previous market, right/down for the next. */
function DPad({ onStep }: { onStep: (d: number) => void }) {
  const arm = "dpad-arm flex items-center justify-center text-[10px] text-[#8d8fa6]";
  return (
    <div className="grid grid-cols-[28px_28px_28px] grid-rows-[28px_28px_28px]" role="group" aria-label="Change market">
      <span />
      <button className={`${arm} rounded-t-md`} onClick={() => onStep(-1)} aria-label="Previous market">▲</button>
      <span />
      <button className={`${arm} rounded-l-md`} onClick={() => onStep(-1)} aria-label="Previous market">◀</button>
      <span className="bg-[#23222f]" aria-hidden />
      <button className={`${arm} rounded-r-md`} onClick={() => onStep(1)} aria-label="Next market">▶</button>
      <span />
      <button className={`${arm} rounded-b-md`} onClick={() => onStep(1)} aria-label="Next market">▼</button>
      <span />
    </div>
  );
}

function OrderForm(props: { market: string; maxLeverage: number; side: Side; setSide: (s: Side) => void }) {
  const { market, maxLeverage, side, setSide } = props;
  const { o, tx, run, prices, me } = useOneUp();
  const [margin, setMargin] = useState("500");
  const [leverage, setLeverage] = useState(50);
  const m = BigInt(Math.floor(Number(margin) || 0)) * USDC;
  const price = prices[market];
  const quote = usePoll(() => o.quoteOpen(market, side, m, leverage, price), [market, side, margin, leverage, price?.toString()]);
  const free = usePoll(() => o.balance(me), [me]);
  const short = free !== undefined && BigInt(free) < m;

  return (
    <div className="panel order-3 flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Side">
        {(["Long", "Short"] as const).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            className="btn display rounded-full py-2 text-lg"
            style={{
              background: side === s ? (s === "Long" ? "var(--long)" : "var(--short)") : "var(--panel-2)",
              color: side === s ? "var(--on-color)" : "var(--muted)",
            }}
          >
            {s === "Long" ? "▲ Long" : "▼ Short"}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="label">Margin (USDC)</span>
        <input className="input num" value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="label flex justify-between">
          <span>Leverage</span>
          <span className="display num text-base text-[var(--text)]">{leverage}×</span>
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
      </label>

      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="label">Position size</dt>
        <dd className="num text-right">${fmtUsdc(m * BigInt(leverage), 0)}</dd>
        <dt className="label">Max profit (9× margin)</dt>
        <dd className="num text-right">${fmtUsdc(maxLiability(m), 0)}</dd>
        <dt className="label">Winner&apos;s cut</dt>
        <dd className="num text-right">{quote ? `${(Number(quote.cut_ppm) / 1e4).toFixed(1)}%` : "…"}</dd>
        <dt className="label">Liquidation price</dt>
        <dd className="num text-right">{quote?.liquidation_price ? fmtPrice(BigInt(quote.liquidation_price)) : "…"}</dd>
      </dl>

      {quote && !quote.allowed && <p className="text-sm text-[var(--short)]">{quote.reason}</p>}
      {short && <p className="text-sm text-[var(--short)]">Not enough free balance. Deposit first.</p>}

      <button
        className="btn display py-3 text-lg"
        style={{ background: side === "Long" ? "var(--long)" : "var(--short)", color: "var(--on-color)" }}
        disabled={!quote?.allowed || short || m === 0n}
        onClick={() => run(`${side} ${market} ${leverage}× · $${margin}`, () => tx.placeOpen(market, side, m, leverage))}
      >
        {side} {market}
      </button>
      <p className="label">
        Fills at the first oracle price after you place the order, so nobody trades on a price they already know. No
        fees, no funding. Lose and you get an Extra Life.
      </p>
    </div>
  );
}

function Positions({ positions, orders }: { positions: Position[]; orders: Order[] }) {
  const { prices } = useOneUp();
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

  return (
    <div className="panel p-4">
      <div className="display mb-3 text-lg">Positions</div>
      {rows.length === 0 && orders.length === 0 && <p className="label">No open positions.</p>}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map(({ p, mark, v, hold }) => (
          <div key={p.id} className="num rounded-lg border border-[var(--line)] p-3 text-sm">
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
              <dd>{fmtPrice(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage))}</dd>
            </dl>
            <CloseButton p={p} hold={hold} wide />
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
              <th className="pb-2 text-right font-normal">PnL</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, mark, v, hold }) => (
              <tr key={p.id} className="border-t border-[var(--line)]">
                <td className="py-2">
                  <span style={{ color: p.side === "Long" ? "var(--long)" : "var(--short)" }}>{p.side}</span> {p.market_id}{" "}
                  {p.leverage}×
                </td>
                <td>${fmtUsdc(BigInt(p.margin) * BigInt(p.leverage), 0)}</td>
                <td>{fmtPrice(BigInt(p.entry_price))}</td>
                <td>{mark ? fmtPrice(mark) : "…"}</td>
                <td>{fmtPrice(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage))}</td>
                <td className="text-right" style={{ color: v >= 0n ? "var(--long)" : "var(--short)" }}>
                  {v >= 0n ? "+" : ""}
                  {fmtUsdc(v)}
                </td>
                <td className="pl-3 text-right">
                  <CloseButton p={p} hold={hold} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {orders.filter((x) => "Open" in x.kind).map((x) => (
        <p key={x.id} className="label mt-2">
          Order {x.id}: {"Open" in x.kind && `${x.kind.Open.side} ${x.market_id} ${x.kind.Open.leverage}×`}, waiting for the
          next oracle price…
        </p>
      ))}
    </div>
  );
}

function CloseButton({ p, hold, wide }: { p: Position; hold: number; wide?: boolean }) {
  const { tx, run } = useOneUp();
  if (p.close_order !== null) return <div className={`label ${wide ? "mt-3 text-center" : ""}`}>closing…</div>;
  return (
    <button
      className={`btn btn-ghost ${wide ? "mt-3 w-full" : "py-1"}`}
      disabled={hold > 0}
      onClick={() => run(`Close #${p.id}`, () => tx.placeClose(p.id))}
    >
      {hold > 0 ? `Close in ${hold}s` : "Close"}
    </button>
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
        <div className="display text-lg leading-tight">Extra Life incoming</div>
        <div className="label num mt-1">
          You lost ${fmtUsdc(loss.amount)} (${fmtUsdc(loss.total)} this epoch). Your Extra Life and $1UP lock mint
          when the epoch ends in {fmtClock(left)}, sized from what the house made.
        </div>
      </div>
      <button className="btn btn-ghost px-3" onClick={() => setLoss(null)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
