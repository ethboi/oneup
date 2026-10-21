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

const MIN_HOLD_S = 60;

export function Trade() {
  const { o, me, prices, history } = useOneUp();
  const markets = usePoll(() => o.markets(), [], 5000) ?? [];
  const [market, setMarket] = useState("NEAR-USD");
  const positions = usePoll(() => o.positions(me), [me]) ?? [];
  const orders = usePoll(() => o.orders(me), [me]) ?? [];

  const marks: Mark[] = positions
    .filter((p) => p.market_id === market)
    .flatMap((p) => [
      { price: priceToNumber(BigInt(p.entry_price)), label: `#${p.id} entry`, color: "var(--info)" },
      {
        price: priceToNumber(liquidationPrice(p.side, BigInt(p.entry_price), p.leverage)),
        label: `#${p.id} liq`,
        color: "var(--short)",
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
        <div className="panel order-2 min-w-0 p-3">
          <div className="-mx-3 mb-2 flex gap-2 overflow-x-auto px-3 sm:flex-wrap">
            {markets.filter((m) => m.live).map((m) => (
              <button
                key={m.id}
                onClick={() => setMarket(m.id)}
                className={`btn ${m.id === market ? "btn-accent" : "btn-ghost"} num shrink-0 whitespace-nowrap`}
              >
                {m.id} {prices[m.id] ? fmtPrice(prices[m.id]) : ""}
              </button>
            ))}
          </div>
          <PriceChart points={history[market] ?? []} marks={marks} />
        </div>
        <div className="order-4 min-w-0">
          <Positions positions={positions} orders={orders} />
        </div>
      </div>
      <OrderForm market={market} maxLeverage={markets.find((m) => m.id === market)?.max_leverage ?? 100} />
    </div>
  );
}

function OrderForm({ market, maxLeverage }: { market: string; maxLeverage: number }) {
  const { o, tx, run, prices, me } = useOneUp();
  const [side, setSide] = useState<Side>("Long");
  const [margin, setMargin] = useState("500");
  const [leverage, setLeverage] = useState(50);
  const m = BigInt(Math.floor(Number(margin) || 0)) * USDC;
  const price = prices[market];
  const quote = usePoll(() => o.quoteOpen(market, side, m, leverage, price), [market, side, margin, leverage, price?.toString()]);
  const free = usePoll(() => o.balance(me), [me]);
  const short = free !== undefined && BigInt(free) < m;

  return (
    <div className="panel order-3 flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-2">
        {(["Long", "Short"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className="btn"
            style={{
              background: side === s ? (s === "Long" ? "var(--long)" : "var(--short)") : "var(--panel-2)",
              color: side === s ? "#0b0d10" : "var(--muted)",
            }}
          >
            {s}
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
          <span className="num text-[var(--text)]">{leverage}×</span>
        </span>
        <input type="range" min={1} max={maxLeverage} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} />
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
        className="btn py-3"
        style={{ background: side === "Long" ? "var(--long)" : "var(--short)", color: "#0b0d10" }}
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
      <div className="mb-3 font-semibold">Positions</div>
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
    <div className="panel flex items-start gap-3 border-[var(--accent)] p-4 sm:items-center sm:gap-4" role="status">
      <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden className="shrink-0">
        <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" fill="none" stroke="var(--accent)" strokeWidth="2" />
        <path d="M12 9v6M9 12h6" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <div className="flex-1">
        <div className="font-semibold">
          You lost ${fmtUsdc(loss.amount)}. That&apos;s an Extra Life in the making.
        </div>
        <div className="label num">
          ${fmtUsdc(loss.total)} lost this epoch. Your Extra Life is minted when the epoch ends in {fmtClock(left)}, sized
          from what the house made.
        </div>
      </div>
      <button className="btn btn-ghost" onClick={() => setLoss(null)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
