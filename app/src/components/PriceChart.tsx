"use client";

// Price line from the app's polled history, with optional horizontal marks (entry, liquidation).
// Drawn at the container's real width (so labels stay 11–12px on a phone) with a crosshair readout
// that follows a mouse or a finger.

import { useState } from "react";
import { useWidth } from "@/lib/useWidth";

export interface Mark {
  price: number;
  label: string;
  color: string;
}

export function PriceChart({ points, marks = [] }: { points: { t: number; p: number }[]; marks?: Mark[] }) {
  const [ref, W] = useWidth();
  const narrow = W < 480;
  const H = narrow ? 220 : 260;
  const PAD = { l: 8, r: narrow ? 64 : 72, t: 12, b: 12 };
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div ref={ref} className="flex h-[220px] items-center justify-center sm:h-[260px]">
        <span className="label">Waiting for prices…</span>
      </div>
    );
  }
  const values = points.map((x) => x.p).concat(marks.map((m) => m.price));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo || hi * 0.002) * 0.15;
  lo -= pad;
  hi += pad;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = points.map((pt, i) => `${i ? "L" : "M"}${x(pt.t).toFixed(1)} ${y(pt.p).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const up = last.p >= points[0].p;
  const color = up ? "var(--long)" : "var(--short)";
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
    <div ref={ref} className="relative">
      <svg
        width={W}
        height={H}
        className="block touch-pan-y select-none"
        role="img"
        aria-label={`Price chart, last ${last.p.toFixed(digits)}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        <defs>
          <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.25" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${x(t1)} ${H - PAD.b} L${x(t0)} ${H - PAD.b} Z`} fill="url(#fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" />
        {marks.map((m) => (
          <g key={m.label}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(m.price)} y2={y(m.price)} stroke={m.color} strokeDasharray="4 4" />
            <text x={W - PAD.r + 4} y={y(m.price) + 4} fontSize="11" fill={m.color}>
              {narrow ? m.label.replace(/^#\d+ /, "") : m.label}
            </text>
          </g>
        ))}
        <circle cx={x(last.t)} cy={y(last.p)} r="4" fill={color} />
        <text x={W - PAD.r + 4} y={y(last.p) - 8} fontSize="12" fontWeight="600" fill="var(--text)" className="num">
          {last.p.toFixed(digits)}
        </text>
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeDasharray="2 3" />
            <circle cx={x(h.t)} cy={y(h.p)} r="5" fill={color} stroke="var(--panel)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="panel num pointer-events-none absolute top-1 px-2 py-1 text-xs"
          style={x(h.t) > W / 2 ? { right: W - x(h.t) + 8 } : { left: x(h.t) + 8 }}
        >
          <div className="font-semibold">{h.p.toFixed(digits)}</div>
          <div className="label">{new Date(h.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
        </div>
      )}
    </div>
  );
}
