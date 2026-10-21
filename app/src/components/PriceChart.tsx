"use client";

// The console's LCD: price line from the app's polled history, in four shades of green, with entry and
// liquidation marks told apart by dash pattern (the screen has no colours to spare). Drawn at the
// container's real width with a crosshair readout that follows a mouse or a finger. The time axis slides
// with the clock and each new price eases in, so the line moves steadily between oracle updates.

import { useEffect, useState } from "react";
import { useWidth } from "@/lib/useWidth";

export interface Mark {
  price: number;
  label: string;
  kind: "entry" | "liq";
}

const DASH = { entry: "6 4", liq: "2 3" } as const;
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

export function PriceChart({ points, marks = [] }: { points: { t: number; p: number }[]; marks?: Mark[] }) {
  const [ref, W] = useWidth();
  const narrow = W < 480;
  const H = narrow ? 210 : 250;
  const PAD = { l: 10, r: narrow ? 64 : 84, t: 34, b: 14 }; // room at the top for the readout the console prints on screen
  const [hover, setHover] = useState<number | null>(null);
  const now = useClock();

  if (points.length < 2) {
    return (
      <div ref={ref} className="lcd flex h-[210px] items-center justify-center sm:h-[250px]">
        <span className="display text-[var(--lcd-3)]">Waiting for prices…</span>
      </div>
    );
  }
  const values = points.map((x) => x.p).concat(marks.map((m) => m.price));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo || hi * 0.002) * 0.15;
  lo -= pad;
  hi += pad;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  // the newest price eases in from the one before; the line then holds it out to the present
  const k = now === null ? 1 : Math.min(1, Math.max(0, (now - last.t) / EASE_MS));
  const headP = prev.p + (last.p - prev.p) * (1 - (1 - k) ** 3);
  const t0 = points[0].t;
  const t1 = now === null ? last.t : Math.max(last.t, now);
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line =
    points
      .slice(0, -1)
      .map((pt, i) => `${i ? "L" : "M"}${x(pt.t).toFixed(1)} ${y(pt.p).toFixed(1)}`)
      .join(" ") + ` L${x(last.t).toFixed(1)} ${y(headP).toFixed(1)} L${x(t1).toFixed(1)} ${y(headP).toFixed(1)}`;
  const digits = last.p < 10 ? 4 : last.p < 1000 ? 2 : 0;
  const h = hover === null ? null : points[hover];

  const onPointer = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0);
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
        {/* a faint price grid: four levels across the range */}
        {[0.2, 0.4, 0.6, 0.8].map((f) => {
          const v = lo + (hi - lo) * f;
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--lcd-2)" strokeWidth="1" opacity="0.6" />
              {/* on the left, so they never collide with the price and the entry/liq labels on the right */}
              <text x={PAD.l + 4} y={y(v) - 4} fontSize="10" fill="var(--lcd-3)" className="num">
                {v.toFixed(digits)}
              </text>
            </g>
          );
        })}
        <path d={`${line} L${x(t1)} ${H - PAD.b} L${x(t0)} ${H - PAD.b} Z`} fill="var(--lcd-2)" opacity="0.45" />
        <path d={line} fill="none" stroke="var(--lcd-ink)" strokeWidth="2.5" strokeLinejoin="round" />
        {marks.map((m) => (
          <g key={m.label}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(m.price)}
              y2={y(m.price)}
              stroke={m.kind === "liq" ? "var(--lcd-ink)" : "var(--lcd-3)"}
              strokeWidth={m.kind === "liq" ? 2 : 1.5}
              strokeDasharray={DASH[m.kind]}
            />
            <text x={W - PAD.r + 6} y={y(m.price) + 4} fontSize="12" fill="var(--lcd-ink)">
              {narrow ? m.label.replace(/^#\d+ /, "") : m.label}
            </text>
          </g>
        ))}
        <rect x={x(t1) - 4} y={y(headP) - 4} width="8" height="8" fill="var(--lcd-ink)" />
        <text x={W - PAD.r + 6} y={y(headP) - 8} fontSize="14" fontWeight="700" fill="var(--lcd-ink)" className="num">
          {last.p.toFixed(digits)}
        </text>
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--lcd-3)" strokeDasharray="2 3" />
            <rect x={x(h.t) - 5} y={y(h.p) - 5} width="10" height="10" fill="var(--lcd)" stroke="var(--lcd-ink)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="display num pointer-events-none absolute top-2 rounded-md border border-[var(--lcd-ink)] bg-[var(--lcd)] px-2 py-1 text-xs text-[var(--lcd-ink)]"
          style={x(h.t) > W / 2 ? { right: W - x(h.t) + 10 } : { left: x(h.t) + 10 }}
        >
          <div className="text-sm">{h.p.toFixed(digits)}</div>
          <div>{new Date(h.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
        </div>
      )}
    </div>
  );
}
