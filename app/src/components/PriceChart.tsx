"use client";

// Price line from the app's polled history, with optional horizontal marks (entry, liquidation).

export interface Mark {
  price: number;
  label: string;
  color: string;
}

export function PriceChart({ points, marks = [] }: { points: { t: number; p: number }[]; marks?: Mark[] }) {
  const W = 760;
  const H = 260;
  const PAD = { l: 8, r: 72, t: 12, b: 12 };
  if (points.length < 2) {
    return (
      <div className="flex h-[260px] items-center justify-center">
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[260px] w-full" role="img" aria-label="Price chart">
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
            {m.label}
          </text>
        </g>
      ))}
      <circle cx={x(last.t)} cy={y(last.p)} r="4" fill={color} />
      <text x={W - PAD.r + 4} y={y(last.p) - 8} fontSize="12" fontWeight="600" fill="var(--text)" className="num">
        {last.p.toFixed(digits)}
      </text>
    </svg>
  );
}
