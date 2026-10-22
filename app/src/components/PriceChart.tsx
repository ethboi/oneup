"use client";

// The console's LCD: price line from the app's polled history, in four shades of green, with entry,
// liquidation, take-profit and stop-loss marks told apart by dash pattern and label (the screen has no
// colours to spare). The scale fits the price; marks too far away to draw wait at the edge with an arrow.
// Drawn at the container's real width with a crosshair readout that follows a mouse or a finger. The time
// axis slides with the clock and each new price eases in, so the line moves steadily between oracle updates.

import { useEffect, useState } from "react";
import { useWidth } from "@/lib/useWidth";

export interface Mark {
  price: number;
  label: string;
  kind: "entry" | "liq" | "tp" | "sl";
  /** The position it belongs to, so its zones can be shaded. */
  pos?: number;
  /** On an entry: the position's profit if closed now (USDC, after the winner's cut) and as % of margin. */
  pnl?: { usd: number; pct: number };
  /** Another position's entry: a faint line only, with no label, zone or effect on the scale. */
  faint?: boolean;
  /** On an entry: the price where the position hits its 9× profit cap (its green zone deepens toward this
   *  when there's no take-profit). */
  cap?: number;
  /** On an entry: when the position opened (ms), where its shading starts. */
  since?: number;
}

/** Candle widths: the first that puts at most 48 across the window. */
const CANDLE_STEPS = [2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000];

type Candle = { t: number; o: number; h: number; l: number; c: number };

/** Buckets prices into candles of `size` ms from `from`; each opens at the close before it. */
function candles(points: { t: number; p: number }[], from: number, size: number, head: number): Candle[] {
  const out: Candle[] = [];
  let prevClose = points[0].p;
  for (const pt of points) {
    const t = Math.floor(pt.t / size) * size;
    if (t < from - size) {
      prevClose = pt.p;
      continue;
    }
    const c = out[out.length - 1];
    if (c && c.t === t) {
      c.h = Math.max(c.h, pt.p);
      c.l = Math.min(c.l, pt.p);
      c.c = pt.p;
    } else {
      out.push({ t, o: prevClose, h: Math.max(prevClose, pt.p), l: Math.min(prevClose, pt.p), c: pt.p });
    }
    prevClose = pt.p;
  }
  // the newest price eases in, as on the line
  const c = out[out.length - 1];
  if (c) {
    c.c = head;
    c.h = Math.max(c.h, head);
    c.l = Math.min(c.l, head);
  }
  return out;
}

const DASH = { entry: "6 4", liq: "2 3", tp: "10 3 2 3", sl: "10 3 2 3" } as const;
/** The recent trail's shortest length, and how long a new tick shows on the price tag. */
const TRAIL_MS = 15_000;
const TICK_MS = 1_200;
/** How long a new price takes to ease in. */
const EASE_MS = 500;

/** The clock, at about 30 frames a second; frozen (null) when the viewer prefers reduced motion. */
function useClock(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      if (t - last > 33) {
        last = t;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
}

/** A round step near `span / n`: 1, 2, 2.5 or 5 × a power of ten. */
function niceStep(span: number, n: number) {
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((f) => f * mag >= raw) ?? 10) * mag;
}

/** The fewest decimals that print `step` exactly. */
function decimalsOf(step: number) {
  for (let d = 0; d < 8; d++) if (Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-6) return d;
  return 8;
}

/** Time-axis steps: the first that puts at most five ticks across the window. */
const TIME_STEPS = [5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const ago = (ms: number) => (ms >= 60_000 ? `−${ms / 60_000}m` : `−${ms / 1000}s`);

/** The scale never spans less than 0.1% of the price, so one-tick moves don't fill the screen. */
const MIN_SPAN = 0.001;
/** Marks this close to the price (0.5%) always join the scale. */
const NEAR_MARK = 0.005;
/** Label spacing on the right edge, in px. */
const GAP = 15;

/** Moves sorted label positions apart by at least `gap`, keeping them inside [top, bottom]. */
function spread(ys: number[], gap: number, top: number, bottom: number) {
  const out = ys.slice();
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  if (out.length && out[out.length - 1] > bottom) out[out.length - 1] = bottom;
  for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  if (out.length && out[0] < top) for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], top + i * gap);
  return out;
}

/**
 * `alarm`: a position here is near liquidation, so its liquidation line blinks. `readout` and `gauge` are printed
 * on the screen's top edge; on a phone they take a row each.
 */
export function PriceChart({
  points,
  marks: allMarks = [],
  alarm,
  readout,
  gauge,
  span,
  candles: asCandles,
}: {
  points: { t: number; p: number }[];
  /** The window shown, in ms, ending now: the time axis stays put while the line scrolls through it. */
  span?: number;
  /** Draw candles instead of a line. */
  candles?: boolean;
  marks?: Mark[];
  alarm?: boolean;
  readout?: React.ReactNode;
  gauge?: React.ReactNode;
}) {
  const [ref, W] = useWidth();
  // the chart details one position; the others only show where they came in
  const marks = allMarks.filter((m) => !m.faint);
  const faint = allMarks.filter((m) => m.faint);
  const narrow = W < 480;
  const H = narrow ? 300 : 420;
  // room at the top for the readout, at the bottom for the time axis
  // the right edge holds the price tag, plus the mark labels when a position is shown
  const PAD = { l: 10, r: narrow ? 78 : marks.length ? 160 : 90, t: narrow && gauge ? 58 : 36, b: 22 };
  const [hover, setHover] = useState<number | null>(null);
  const now = useClock();

  const header = (
    <div
      className={`display num pointer-events-none absolute left-3 right-3 top-2 flex text-[var(--lcd-ink)] ${narrow ? "flex-col items-start gap-1" : "items-baseline justify-between gap-3"}`}
    >
      {readout}
      {gauge}
    </div>
  );

  if (points.length < 2) {
    return (
      <div ref={ref} className="lcd relative flex h-[300px] items-center justify-center sm:h-[420px]">
        {header}
        <span className="display text-[var(--lcd-3)]">Waiting for prices…</span>
      </div>
    );
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  // the scale fits the price, not the marks: a liquidation line 2% away would flatten a 0.02% move to nothing.
  // Marks near the line join the scale; the rest wait at the edge with an arrow.
  let lo = Math.min(...points.map((x) => x.p));
  let hi = Math.max(...points.map((x) => x.p));
  const min = last.p * MIN_SPAN;
  if (hi - lo < min) {
    const mid = (hi + lo) / 2;
    lo = mid - min / 2;
    hi = mid + min / 2;
  }
  // within a range of the line, or 0.5% of the price, whichever is wider: entry and triggers usually are
  const reach = Math.max(hi - lo, last.p * NEAR_MARK);
  for (const m of marks) {
    if (m.price >= lo - reach && m.price <= hi + reach) {
      lo = Math.min(lo, m.price);
      hi = Math.max(hi, m.price);
    }
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;

  // the newest price eases in from the one before; the line then holds it out to the present
  const k = now === null ? 1 : Math.min(1, Math.max(0, (now - last.t) / EASE_MS));
  const headP = prev.p + (last.p - prev.p) * (1 - (1 - k) ** 3);
  const t1 = now === null ? last.t : Math.max(last.t, now);
  const t0 = span ? t1 - span : points[0].t;
  const plotR = W - PAD.r;
  const plotB = H - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (plotR - PAD.l);
  const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * (plotB - PAD.t);
  const line =
    points
      .slice(0, -1)
      .map((pt, i) => `${i ? "L" : "M"}${x(pt.t).toFixed(1)} ${y(pt.p).toFixed(1)}`)
      .join(" ") + ` L${x(last.t).toFixed(1)} ${y(headP).toFixed(1)} L${x(t1).toFixed(1)} ${y(headP).toFixed(1)}`;
  // cents on BTC and ETH too: a $0.80 move matters at 50×
  const digits = last.p < 10 ? 4 : 2;
  // the last tenth of the window (at least 15 s), drawn heavier so the latest moves stand out at any zoom
  const trailMs = Math.max(TRAIL_MS, (t1 - t0) / 10);
  const recent = points.filter((pt, i) => i < points.length - 1 && pt.t >= t1 - trailMs);
  const trail =
    recent.map((pt, i) => `${i ? "L" : "M"}${x(pt.t).toFixed(1)} ${y(pt.p).toFixed(1)}`).join(" ") +
    `${recent.length ? " L" : "M"}${x(last.t).toFixed(1)} ${y(headP).toFixed(1)} L${x(t1).toFixed(1)} ${y(headP).toFixed(1)}`;
  // a fresh tick: which way it went, shown on the price tag for a moment
  const fresh = now !== null && now - last.t < TICK_MS && last.p !== prev.p;
  const tickUp = last.p > prev.p;
  const h = hover === null ? null : points[hover];

  // one position here: its marks don't need its number
  const many = new Set(marks.map((m) => m.label.split(" ")[0])).size > 1;
  const name = (m: Mark) => (many && !narrow ? m.label : m.label.replace(/^#\d+ /, ""));
  const shown = marks.map((m) => ({ m, edge: m.price > hi ? "up" : m.price < lo ? "down" : null }));
  // how far the price has come from entry, and how far liquidation is (always on a phone when it's close)
  const pctFrom = (a: number, b: number) => ((b - a) / a) * 100;
  const away = (m: Mark) => {
    if (m.kind === "entry" && !narrow) {
      const d = pctFrom(m.price, last.p);
      return ` · ${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}%`;
    }
    if (m.kind === "liq" && (!narrow || alarm)) return ` · ${Math.abs(pctFrom(last.p, m.price)).toFixed(1)}%`;
    return "";
  };

  // right-edge labels: the price first, then each mark, nudged apart so none overlap
  const labels = [
    { key: "head", y: y(headP), text: `${fresh ? (tickUp ? "▲ " : "▼ ") : ""}${last.p.toFixed(digits)}`, head: true, kind: undefined as Mark["kind"] | undefined },
    ...shown.map(({ m, edge }) => ({
      key: m.label,
      y: edge === "up" ? PAD.t : edge === "down" ? plotB : y(m.price),
      text: `${edge === "up" ? "▲ " : edge === "down" ? "▼ " : ""}${name(m)}${narrow ? "" : ` ${m.price.toFixed(digits)}`}${away(m)}`,
      head: false,
      kind: m.kind,
    })),
  ].sort((a, b) => a.y - b.y);
  const placed = spread(labels.map((l) => l.y), GAP, PAD.t + 4, plotB - 2);

  // price grid at round numbers; a label that would sit on a mark or the price is left off
  const step = niceStep(hi - lo, narrow ? 3 : 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const busy = [y(headP), ...shown.filter((s) => !s.edge).map((s) => y(s.m.price))];

  // the focused position's shading fills between the price line and its entry, from when it opened: green on
  // the profit side, deepening toward the take-profit (or the 9× cap), red on the loss side, deepening toward the
  // stop-loss (or liquidation)
  const entry = marks.find((m) => m.kind === "entry" && m.pos !== undefined && m.cap !== undefined);
  const zone = (() => {
    if (!entry) return null;
    const mine = marks.filter((m) => m.pos === entry.pos);
    const long = entry.cap! > entry.price;
    const target = mine.find((m) => m.kind === "tp")?.price ?? entry.cap!;
    const stop = (mine.find((m) => m.kind === "sl") ?? mine.find((m) => m.kind === "liq"))?.price;
    const yE = y(entry.price);
    const x0 = Math.max(PAD.l, x(entry.since ?? t0));
    return { yE, x0, upIsProfit: long, profitTo: y(target), lossTo: stop === undefined ? (long ? plotB : PAD.t) : y(stop) };
  })();
  // live profit on each visible entry line
  const pills = shown
    .filter(({ m, edge }) => !edge && m.kind === "entry" && m.pnl)
    .map(({ m }) => {
      const { usd, pct } = m.pnl!;
      const sign = usd >= 0 ? "+" : "−";
      const amount = `${sign}$${Math.abs(usd).toLocaleString("en-US", { maximumFractionDigits: Math.abs(usd) >= 1000 ? 0 : 2, minimumFractionDigits: Math.abs(usd) >= 1000 ? 0 : 2 })}`;
      const text = narrow ? amount : `${amount} (${sign}${Math.abs(pct).toFixed(1)}%)`;
      // kept below the readout when the entry sits near the top
      return { key: m.label, y: Math.max(PAD.t + 20, y(m.price)), text, up: usd >= 0, w: (text.length + 2) * 7.4 + 12 };
    });
  const tickDigits = Math.max(decimalsOf(step), 0);

  // ticks are fixed distances back from now, so they never move or blink as the line scrolls
  const tStep = TIME_STEPS.find((s) => (t1 - t0) / s <= 5) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const times: number[] = [];
  for (let a = tStep; a <= (t1 - t0) * 0.94; a += tStep) times.push(a);

  const cSize = CANDLE_STEPS.find((s) => (t1 - t0) / s <= 48) ?? CANDLE_STEPS[CANDLE_STEPS.length - 1];
  const bars = asCandles ? candles(points, t0, cSize, headP) : null;
  const cW = Math.max(2, ((plotR - PAD.l) * cSize) / Math.max(1, t1 - t0) * 0.62);

  const onPointer = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left - PAD.l) / (plotR - PAD.l)) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best);
  };

  return (
    <div ref={ref} className="lcd relative">
      <svg
        width={W}
        height={H}
        className="display block touch-pan-y select-none"
        role="img"
        aria-label={`Price chart, last ${last.p.toFixed(digits)}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        <defs>
          <clipPath id="lcd-plot">
            <rect x={PAD.l} y={0} width={plotR - PAD.l + 4} height={plotB} />
          </clipPath>
          <linearGradient id="lcd-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--lcd-2)" stopOpacity="0.7" />
            <stop offset="1" stopColor="var(--lcd-2)" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={plotR} y1={y(v)} y2={y(v)} stroke="var(--lcd-2)" strokeWidth="1" opacity="0.6" />
            {/* on the left, so they never collide with the price and the mark labels on the right */}
            {busy.every((b) => Math.abs(b - y(v)) > 11) && y(v) - PAD.t > 12 && (
              <text x={PAD.l + 4} y={y(v) - 4} fontSize="10" fill="var(--lcd-3)" className="num">
                {v.toFixed(tickDigits)}
              </text>
            )}
          </g>
        ))}
        {/* time axis: how long ago, with the present at the head */}
        <line x1={PAD.l} x2={plotR} y1={plotB} y2={plotB} stroke="var(--lcd-3)" strokeWidth="1" opacity="0.6" />
        {times.map((a) => (
          <g key={a}>
            <line x1={x(t1 - a)} x2={x(t1 - a)} y1={plotB} y2={plotB + 4} stroke="var(--lcd-3)" />
            <text x={x(t1 - a)} y={H - 5} fontSize="10" fill="var(--lcd-3)" textAnchor="middle" className="num">
              {ago(a)}
            </text>
          </g>
        ))}
        <text x={x(t1)} y={H - 5} fontSize="10" fill="var(--lcd-3)" textAnchor="end">
          now
        </text>
        {zone && (
          <g clipPath="url(#lcd-plot)">
            <defs>
              <linearGradient id="zone-profit" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={zone.yE} y2={zone.profitTo}>
                <stop offset="0" stopColor="var(--long)" stopOpacity="0.2" />
                <stop offset="1" stopColor="var(--long)" stopOpacity="0.6" />
              </linearGradient>
              <linearGradient id="zone-loss" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={zone.yE} y2={zone.lossTo}>
                <stop offset="0" stopColor="var(--short)" stopOpacity="0.24" />
                <stop offset="1" stopColor="var(--short)" stopOpacity="0.6" />
              </linearGradient>
              <clipPath id="zone-above">
                <rect x={zone.x0} y={0} width={W} height={Math.max(0, zone.yE)} />
              </clipPath>
              <clipPath id="zone-below">
                <rect x={zone.x0} y={zone.yE} width={W} height={Math.max(0, H - zone.yE)} />
              </clipPath>
            </defs>
            {/* between the line and the entry: above it in one colour, below it in the other */}
            <path d={`${line} L${x(t1)} ${zone.yE} L${x(points[0].t)} ${zone.yE} Z`} fill={`url(#zone-${zone.upIsProfit ? "profit" : "loss"})`} clipPath="url(#zone-above)" />
            <path d={`${line} L${x(t1)} ${zone.yE} L${x(points[0].t)} ${zone.yE} Z`} fill={`url(#zone-${zone.upIsProfit ? "loss" : "profit"})`} clipPath="url(#zone-below)" />
          </g>
        )}
        <g clipPath="url(#lcd-plot)">
          {bars ? (
            bars.map((c) => {
              const cx = x(c.t + cSize / 2);
              const up = c.c >= c.o;
              const top = y(Math.max(c.o, c.c));
              return (
                <g key={c.t}>
                  <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke="var(--lcd-ink)" strokeWidth="1.5" />
                  {/* up candles hollow, down candles solid: the monochrome screen's way of telling them apart */}
                  <rect
                    x={cx - cW / 2}
                    y={top}
                    width={cW}
                    height={Math.max(1.5, y(Math.min(c.o, c.c)) - top)}
                    fill={up ? "var(--lcd)" : "var(--lcd-ink)"}
                    stroke="var(--lcd-ink)"
                    strokeWidth="1.5"
                  />
                </g>
              );
            })
          ) : (
            <>
              {/* the fill would muddy a position's zone, so it only shows on its own */}
              {!zone && <path d={`${line} L${x(t1)} ${plotB} L${x(points[0].t)} ${plotB} Z`} fill="url(#lcd-fill)" />}
              <path d={line} fill="none" stroke="var(--lcd-ink)" strokeWidth="2.5" strokeLinejoin="round" />
              <path d={trail} fill="none" stroke="var(--lcd-ink)" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
        </g>
        {shown.map(({ m, edge }) =>
          edge ? null : (
            <line
              key={m.label}
              className={alarm && m.kind === "liq" ? "blink" : undefined}
              x1={PAD.l}
              x2={plotR}
              y1={y(m.price)}
              y2={y(m.price)}
              stroke={m.kind === "liq" ? "var(--lcd-ink)" : "var(--lcd-3)"}
              strokeWidth={m.kind === "liq" ? (alarm ? 3.5 : 2) : 1.5}
              strokeDasharray={DASH[m.kind]}
            />
          ),
        )}
        {/* printed in the screen's own ink, like the price tag: the sign carries profit or loss, not a colour */}
        {pills.map((p) => (
          <g key={p.key}>
            <rect x={plotR - p.w - 6} y={p.y - 19} width={p.w} height="16" rx="2" fill="var(--lcd-ink)" />
            <text x={plotR - 12} y={p.y - 7} fontSize="12" fontWeight="700" textAnchor="end" fill="var(--lcd)" className="num">
              {p.up ? "▲ " : "▼ "}
              {p.text}
            </text>
          </g>
        ))}
        {faint
          .filter((m) => m.price >= lo && m.price <= hi)
          .map((m) => (
            <line key={m.label} x1={PAD.l} x2={plotR} y1={y(m.price)} y2={y(m.price)} stroke="var(--lcd-3)" strokeWidth="1" strokeDasharray={DASH.entry} opacity="0.45" />
          ))}
        {/* the present price, ruled across so it reads against the marks */}
        <line x1={x(t1)} x2={plotR + 2} y1={y(headP)} y2={y(headP)} stroke="var(--lcd-ink)" strokeWidth="1" />
        {/* keyed by the tick, so each new price pops the marker */}
        <rect key={last.t} className="tick-pulse" x={x(t1) - 4} y={y(headP) - 4} width="8" height="8" fill="var(--lcd-ink)" />
        {labels.map((l, i) => (
          <g key={l.key} className={alarm && l.kind === "liq" ? "blink" : undefined}>
            {/* a leader when the label had to move off its line */}
            {Math.abs(placed[i] - l.y) > 2 && (
              <line x1={plotR} x2={plotR + 4} y1={l.y} y2={placed[i]} stroke="var(--lcd-3)" strokeWidth="1" />
            )}
            {l.head ? (
              <>
                {/* sized to the price, about 7.6px a character at 13px */}
                <rect
                  key={fresh ? last.t : "still"}
                  className={fresh ? "tick-tag" : undefined}
                  x={plotR + 4}
                  y={placed[i] - 9}
                  width={Math.min(PAD.r - 2, l.text.length * 7.6 + 10)}
                  height="18"
                  rx="2"
                  fill="var(--lcd-ink)"
                />
                <text x={plotR + 8} y={placed[i] + 5} fontSize="13" fontWeight="700" fill="var(--lcd)" className="num">
                  {l.text}
                </text>
              </>
            ) : (
              <text x={plotR + 6} y={placed[i] + 4} fontSize="11" fontWeight={alarm && l.kind === "liq" ? 800 : undefined} fill="var(--lcd-ink)" className="num">
                {l.text}
              </text>
            )}
          </g>
        ))}
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={plotB} stroke="var(--lcd-3)" strokeDasharray="2 3" />
            <rect x={x(h.t) - 5} y={y(h.p) - 5} width="10" height="10" fill="var(--lcd)" stroke="var(--lcd-ink)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {header}
      {h && (
        <div
          className="display num pointer-events-none absolute rounded-md border border-[var(--lcd-ink)] bg-[var(--lcd)] px-2 py-1 text-xs text-[var(--lcd-ink)]"
          style={{ top: PAD.t, ...(x(h.t) > W / 2 ? { right: W - x(h.t) + 10 } : { left: x(h.t) + 10 }) }}
        >
          <div className="text-sm">{h.p.toFixed(digits)}</div>
          <div>{new Date(h.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
        </div>
      )}
    </div>
  );
}
