"use client";

// "Fair to late players": USDC recovered within a year per $1 lost, by when the loss happened, from the
// simulation (sim/). OneUp with expiring lives, OneUp as first specified, and Papertrade-style rules.

import { useEffect, useState } from "react";

interface Results {
  params: { seeds: number; lifeExpiryEpochs: number; window: number; measured: number };
  series: { week: number; oneup: number; oneupNoExpiry: number; papertrade: number }[];
  quarters: { oneup: number[]; oneupNoExpiry: number[]; papertrade: number[] };
  y1ShareOfY3: { oneup: number; papertrade: number; losses: number };
}

const SERIES = [
  { key: "oneup", label: "OneUp", color: "var(--series-1)", dash: undefined },
  { key: "papertrade", label: "Papertrade-style", color: "var(--series-2)", dash: undefined },
  { key: "oneupNoExpiry", label: "OneUp, no expiry", color: "var(--series-3)", dash: "6 5" },
] as const;

const cents = (x: number) => `${(x * 100).toFixed(1)}¢`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function Fairness() {
  const [r, setR] = useState<Results | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/sim").then(async (x) => (x.ok ? setR(await x.json()) : setErr((await x.json()).error)));
  }, []);
  if (err) return <p className="label">{err}</p>;
  if (!r) return <p className="label">Loading…</p>;
  const [first, , , last] = r.quarters.oneup;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel p-5">
        <p className="text-lg">
          A dollar lost in year 3 gets back <span className="num font-bold">{cents(last)}</span> within a year, about what a
          dollar lost early gets (<span className="num font-bold">{cents(first)}</span>). Year-1 losers take{" "}
          <span className="num font-bold">{pct(r.y1ShareOfY3.oneup)}</span> of year-3 payouts, against{" "}
          <span className="num font-bold">{pct(r.y1ShareOfY3.papertrade)}</span> under Papertrade-style rules.
        </p>
        <p className="label mt-1">
          Extra Lives earn for {r.params.lifeExpiryEpochs} epochs after the one they&apos;re minted in, so old claims
          can&apos;t crowd out new ones. Simulation: the same trader flows under each set of rules, {r.params.seeds} seeds,
          each loss followed for {r.params.window} weeks.
        </p>
        <Chart r={r} />
      </div>

      <div className="panel overflow-x-auto p-5">
        <div className="font-semibold">USDC back within a year per $1 lost, by when the loss happened</div>
        <table className="num mt-3 w-full min-w-[560px] text-sm">
          <thead>
            <tr className="label text-left">
              <th className="pb-2 font-normal">Rules</th>
              {["Weeks 1–39", "40–78", "79–117", "118–156"].map((h) => (
                <th key={h} className="pb-2 text-right font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SERIES.map((s) => (
              <tr key={s.key} className="border-t border-[var(--line)]">
                <td className="py-2">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </td>
                {r.quarters[s.key].map((v, i) => (
                  <td key={i} className="text-right">
                    {cents(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chart({ r }: { r: Results }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 300;
  const P = { l: 44, r: 150, t: 16, b: 34 };
  const pts = r.series;
  const max = Math.max(...pts.flatMap((p) => [p.oneup, p.oneupNoExpiry, p.papertrade])) * 1.1;
  const x = (i: number) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const ticks = [0, 0.1, 0.2, 0.3].filter((t) => t <= max);
  const path = (k: (typeof SERIES)[number]["key"]) => pts.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p[k])}`).join(" ");
  // end labels, nudged apart so they don't collide
  const ends = SERIES.map((s) => ({ ...s, y: y(pts[pts.length - 1][s.key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 16);

  return (
    <div className="relative mt-4">
      <div className="mb-2 flex flex-wrap gap-4 text-sm">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" x2="18" y1="4" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Cents back within a year per dollar lost, by week of the loss"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={P.l - 8} y={y(t) + 4} fontSize="12" textAnchor="end" fill="var(--muted)">
              {Math.round(t * 100)}¢
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          i % 4 === 0 || i === pts.length - 1 ? (
            <text key={p.week} x={x(i)} y={H - 10} fontSize="12" textAnchor="middle" fill="var(--muted)">
              week {p.week}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--muted)" strokeDasharray="3 3" />}
        {SERIES.map((s) => (
          <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
        ))}
        {hover !== null &&
          SERIES.map((s) => <circle key={s.key} cx={x(hover)} cy={y(pts[hover][s.key])} r="4.5" fill={s.color} stroke="var(--panel)" strokeWidth="2" />)}
        {ends.map((s) => (
          <text key={s.key} x={W - P.r + 10} y={s.y + 4} fontSize="12" fill="var(--text)">
            {s.label} {cents(pts[pts.length - 1][s.key])}
          </text>
        ))}
        {pts.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (W - P.l - P.r) / (pts.length - 1) / 2}
            y={P.t}
            width={(W - P.l - P.r) / (pts.length - 1)}
            height={H - P.t - P.b}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="panel pointer-events-none absolute top-10 px-3 py-2 text-sm shadow-lg"
          style={{ left: `min(calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 220px))` }}
        >
          <div className="label">Losses in weeks {pts[hover].week}–{pts[hover].week + 12}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="num flex justify-between gap-4">
              <span>{s.label}</span>
              <span>{cents(pts[hover][s.key])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
