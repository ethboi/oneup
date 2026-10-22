"use client";

// The console's LCD: price line from the app's polled history, in four shades of green, with entry,
// liquidation, take-profit and stop-loss marks told apart by dash pattern and label (the screen has no
// colours to spare). The scale fits the price; marks too far away to draw wait at the edge with an arrow.
// Drawn at the container's real width with a crosshair readout that follows a mouse or a finger. The time
// axis slides with the clock and each new price eases in, so the line moves steadily between oracle updates.

import { useCallback, useEffect, useState } from "react";
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
/** How long a new tick shows on the price tag. */
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
/** Tag spacing on the price axis, in px (a tag is 18px tall). */
const GAP = 19;
/** Spacing of the mark names inside the plot, in px. */
const NAME_GAP = 13;
/** Where the axis's text starts, past the slot for the tick's arrow. */
const AXIS_TEXT = 22;

/** Moves sorted label positions apart by at least `gap`, keeping them inside [top, bottom]. */
function spread(ys: number[], gap: number, top: number, bottom: number) {
  const out = ys.slice();
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  if (out.length && out[out.length - 1] > bottom) out[out.length - 1] = bottom;
  for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  if (out.length && out[0] < top) for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], top + i * gap);
  return out;
}

/** How tall the chart can be to end this far above the window's bottom: the bezel under it and a peek of the
 *  positions' tabs. Measured from the page top, so scrolling doesn't change it. */
const FILL_BELOW = 120;
const FILL_MAX = 1000;
function useFillHeight(el: HTMLElement | null) {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    if (!el) return;
    const measure = () => setH(Math.min(FILL_MAX, Math.round(window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - FILL_BELOW)));
    measure();
    window.addEventListener("resize", measure);
    // the onboarding intro above can close, moving the chart up
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [el]);
  return h;
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
  fill,
}: {
  /** On a desktop, grow to fill the window's height (keeping room for the positions' tabs below). */
  fill?: boolean;
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
  const [widthRef, W] = useWidth();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((n: HTMLDivElement | null) => (widthRef(n), setEl(n)), [widthRef]);
  const tall = useFillHeight(fill ? el : null);
  // the chart details one position; the others only show where they came in
  const marks = allMarks.filter((m) => !m.faint);
  const faint = allMarks.filter((m) => m.faint);
  const narrow = W < 480;
  const H = narrow ? 300 : Math.max(420, tall ?? 0);
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
  // cents on BTC and ETH too: a $0.80 move matters at 50×
  const digits = last.p < 10 ? 4 : 2;
  // room at the top for the readout, at the bottom for the time axis, and on the right for the price axis: as
  // wide as its longest price, about 7.6px a character at 13px, past the arrow's slot
  const chars = Math.max(...[hi, lo, ...marks.map((m) => m.price)].map((v) => v.toFixed(digits).length));
  const PAD = { l: 10, r: Math.ceil(chars * 7.6 + AXIS_TEXT + 10), t: narrow && gauge ? 58 : 36, b: 22 };

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

  // tags on the price axis: the price filled, each mark outlined, nudged apart so none overlap. A mark off the
  // scale waits at the top or bottom with an arrow in the tag's arrow slot.
  const labels = [
    { key: "head", y: y(headP), text: last.p.toFixed(digits), head: true, edge: null as "up" | "down" | null, kind: undefined as Mark["kind"] | undefined },
    ...shown.map(({ m, edge }) => ({
      key: m.label,
      y: edge === "up" ? PAD.t : edge === "down" ? plotB : y(m.price),
      text: m.price.toFixed(digits),
      head: false,
      edge,
      kind: m.kind,
    })),
  ].sort((a, b) => a.y - b.y);
  const placed = spread(labels.map((l) => l.y), GAP, PAD.t + 4, plotB - 9);
  // each mark's name sits inside the plot on the left, just above its line (the price is on its tag)
  const names = shown
    .map(({ m, edge }) => ({
      key: m.label,
      y: edge === "up" ? PAD.t + 12 : edge === "down" ? plotB - 6 : y(m.price) - 5,
      text: `${edge === "up" ? "▲ " : edge === "down" ? "▼ " : ""}${name(m)}${away(m)}`,
      kind: m.kind,
    }))
    .sort((a, b) => a.y - b.y);
  const namesAt = spread(names.map((n) => n.y), NAME_GAP, PAD.t + 12, plotB - 4);

  // price levels at round numbers on the axis; one that would sit under a tag is left off
  const step = niceStep(hi - lo, narrow ? 4 : 6);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const busy = h ? [...placed, y(h.p)] : placed;

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
            <line x1={plotR} x2={plotR + 4} y1={y(v)} y2={y(v)} stroke="var(--lcd-3)" strokeWidth="1" />
            {busy.every((b) => Math.abs(b - y(v)) > 13) && y(v) >= PAD.t + 6 && y(v) <= plotB - 6 && (
              <text x={plotR + AXIS_TEXT} y={y(v) + 4} fontSize="11" fill="var(--lcd-3)" className="num">
                {v.toFixed(Math.max(tickDigits, digits))}
              </text>
            )}
          </g>
        ))}
        {/* the price axis: its own column on the right, as on a trading screen */}
        <line x1={plotR} x2={plotR} y1={PAD.t - 6} y2={plotB} stroke="var(--lcd-3)" strokeWidth="1" opacity="0.6" />
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
            </>
          )}
        </g>
        {shown.map(({ m, edge }) =>
          edge ? null : (
            <line
              key={m.label}
              className={alarm && m.kind === "liq" ? "blink" : undefined}
              x1={PAD.l}
              x2={plotR + 4}
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
        {/* mark names, haloed in the screen's colour so they read over the line */}
        {names.map((n, i) => (
          <text
            key={n.key}
            className={`num ${alarm && n.kind === "liq" ? "blink" : ""}`}
            x={PAD.l + 4}
            y={namesAt[i]}
            fontSize="11"
            fontWeight={alarm && n.kind === "liq" ? 800 : 700}
            fill="var(--lcd-ink)"
            stroke="var(--lcd)"
            strokeWidth="3"
            paintOrder="stroke"
          >
            {n.text}
          </text>
        ))}
        {/* the present price, ruled across so it reads against the marks */}
        <line x1={x(t1)} x2={plotR + 2} y1={y(headP)} y2={y(headP)} stroke="var(--lcd-ink)" strokeWidth="1" />
        {/* keyed by the tick, so each new price pops the marker */}
        <rect key={`pulse-${last.t}`} className="tick-pulse" x={x(t1) - 4} y={y(headP) - 4} width="8" height="8" fill="var(--lcd-ink)" />
        {labels.map((l, i) => (
          <g key={l.key} className={alarm && l.kind === "liq" ? "blink" : undefined}>
            {/* a leader when the label had to move off its line */}
            {Math.abs(placed[i] - l.y) > 2 && (
              <line x1={plotR} x2={plotR + 4} y1={l.y} y2={placed[i]} stroke="var(--lcd-3)" strokeWidth="1" />
            )}
            {l.head ? (
              <>
                {/* sized to the price, about 7.6px a character at 13px, plus a fixed slot for the tick's arrow so
                    the price never moves when it appears */}
                <rect
                  key={fresh ? `tag-${last.t}` : "tag"}
                  className={fresh ? "tick-tag" : undefined}
                  x={plotR + 4}
                  y={placed[i] - 9}
                  width={PAD.r - 6}
                  height="18"
                  rx="2"
                  fill="var(--lcd-ink)"
                />
                {fresh && (
                  <text key={`arrow-${last.t}`} className="tick-arrow" x={plotR + 8} y={placed[i] + 3} fontSize="11" fill="var(--lcd)">
                    {tickUp ? "▲" : "▼"}
                  </text>
                )}
                <text key="price" x={plotR + 22} y={placed[i] + 5} fontSize="13" fontWeight="700" fill="var(--lcd)" className="num">
                  {l.text}
                </text>
              </>
            ) : (
              <>
                {/* a mark's price, outlined so it's never taken for the price itself */}
                <rect x={plotR + 4} y={placed[i] - 8} width={PAD.r - 6} height="16" rx="2" fill="var(--lcd)" stroke="var(--lcd-ink)" strokeWidth="1.5" />
                {l.edge && (
                  <text x={plotR + 9} y={placed[i] + 4} fontSize="10" fill="var(--lcd-ink)">
                    {l.edge === "up" ? "▲" : "▼"}
                  </text>
                )}
                <text x={plotR + AXIS_TEXT} y={placed[i] + 4} fontSize="11" fontWeight={alarm && l.kind === "liq" ? 800 : 700} fill="var(--lcd-ink)" className="num">
                  {l.text}
                </text>
              </>
            )}
          </g>
        ))}
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={plotB} stroke="var(--lcd-3)" strokeDasharray="2 3" />
            <line x1={x(h.t)} x2={plotR + 4} y1={y(h.p)} y2={y(h.p)} stroke="var(--lcd-3)" strokeDasharray="2 3" />
            <rect x={x(h.t) - 5} y={y(h.p) - 5} width="10" height="10" fill="var(--lcd)" stroke="var(--lcd-ink)" strokeWidth="2" />
            {/* the hovered price on the axis too */}
            <rect x={plotR + 4} y={y(h.p) - 8} width={PAD.r - 6} height="16" rx="2" fill="var(--lcd-3)" />
            <text x={plotR + AXIS_TEXT} y={y(h.p) + 4} fontSize="11" fontWeight="700" fill="var(--lcd)" className="num">
              {h.p.toFixed(digits)}
            </text>
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
