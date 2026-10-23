"use client";

// "Fair to late players": USDC recovered within a year per $1 lost, by when the loss happened, from the
// simulation (sim/). OneUp with expiring lives, OneUp as first specified, and Papertrade-style rules.

import { useEffect, useState } from "react";
import { useWidth } from "@/lib/useWidth";

interface Results {
  params: { seeds: number; lifeExpiryEpochs: number; window: number; measured: number; start: number; peak: number; edge: number; seed: number; utilisation: number };
  series: { week: number; oneup: number; oneupNoExpiry: number; papertrade: number }[];
  quarters: { oneup: number[]; oneupNoExpiry: number[]; papertrade: number[] };
  y1ShareOfY3: { oneup: number; papertrade: number; losses: number };
}

const SERIES = [
  { key: "oneup", label: "OneUp", short: "OneUp", color: "var(--series-1)", dash: undefined },
  { key: "papertrade", label: "Papertrade-style", short: "Papertrade", color: "var(--series-2)", dash: undefined },
  { key: "oneupNoExpiry", label: "OneUp, no expiry", short: "No expiry", color: "var(--series-3)", dash: "6 5" },
] as const;
const QUARTERS = ["1–39", "40–78", "79–117", "118–156"];

const cents = (x: number) => `${(x * 100).toFixed(1)}¢`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function Fairness() {
  const [r, setR] = useState<Results | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/sim").then(async (x) => (x.ok ? setR(await x.json()) : setErr((await x.json()).error))).catch(() => setErr("Recovery scenarios could not load. Please try again."));
  }, []);
  if (err) return <p id="fairness" className="label scroll-mt-4">{err}</p>;
  if (!r) return <p className="label">Loading the simulation…</p>;
  const [first, , , last] = r.quarters.oneup;

  return (
    // a section of the House tab (Solvency.tsx); the footer's "Fair to late players" opens it here
    <div id="fairness" className="panel scroll-mt-4 p-5">
      <h2 className="text-lg font-extrabold">Recovery under one growth scenario</h2>
      <p className="label mt-1 mb-3">An aggregate-flow illustration, not a forecast or fairness proof.</p>
      <p className="text-lg">
        In this scenario, a dollar lost in year 3 gets back <span className="num font-bold">{cents(last)}</span> within a year, compared with what a
        dollar lost early gets (<span className="num font-bold">{cents(first)}</span>). Year-1 losers take{" "}
        <span className="num font-bold">{pct(r.y1ShareOfY3.oneup)}</span> of year-3 payouts, against{" "}
        <span className="num font-bold">{pct(r.y1ShareOfY3.papertrade)}</span> under Papertrade-style rules.
      </p>
      <p className="label mt-1">
        Extra Lives earn for {r.params.lifeExpiryEpochs} rounds after the one they&apos;re minted in, so old claims
        stop receiving future allocations; this does not ensure equal recovery. Simulation: the same trader flows under each set of rules, {r.params.seeds} seeds,
        each loss followed for {r.params.window} weeks. Assumed weekly losses grow from ${r.params.start?.toLocaleString()} to ${r.params.peak?.toLocaleString()}, average house edge {r.params.edge * 100}%, utilisation {r.params.utilisation * 100}%, seed ${r.params.seed?.toLocaleString()} at a 1× backer claim. The separate sensitivity report uses deployment bootstrap amounts and adverse scenarios; synthetic flows can exceed modeled cash because this is not an order-admission simulation.
      </p>
      <Chart r={r} />

      <h2 className="-mx-5 mt-5 border-t border-[var(--line)] px-5 pt-5 text-lg font-extrabold">USDC back within a year per $1 lost, by when the loss happened</h2>
      {/* phones: periods down, rules across, so it fits without scrolling */}
      <table className="num mt-3 w-full text-sm md:hidden">
        <thead>
          <tr className="label text-left">
            <th className="pb-2 font-normal">Weeks</th>
            {SERIES.map((s) => (
              <th key={s.key} className="pb-2 text-right font-normal">
                <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {QUARTERS.map((q, i) => (
            <tr key={q} className="border-t border-[var(--line)]">
              <td className="py-2">{q}</td>
              {SERIES.map((s) => (
                <td key={s.key} className="text-right">
                  {cents(r.quarters[s.key][i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <table className="num mt-3 hidden w-full text-sm md:table">
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
  );
}

function Chart({ r }: { r: Results }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth(900);
  // narrow screens drop the end labels (the legend names the lines) to give the plot the width
  const narrow = W < 560;
  const H = narrow ? 240 : 300;
  const P = { l: 36, r: narrow ? 12 : 150, t: 16, b: 34 };
  const pts = r.series;
  const max = Math.max(...pts.flatMap((p) => [p.oneup, p.oneupNoExpiry, p.papertrade])) * 1.1;
  const x = (i: number) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const ticks = [0, 0.1, 0.2, 0.3].filter((t) => t <= max);
  const path = (k: (typeof SERIES)[number]["key"]) => pts.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p[k])}`).join(" ");
  // end labels, nudged apart so they don't collide
  const ends = SERIES.map((s) => ({ ...s, y: y(pts[pts.length - 1][s.key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 16);
  const onPointer = (e: React.PointerEvent) => {
    const fx = (e.clientX - e.currentTarget.getBoundingClientRect().left - P.l) / (W - P.l - P.r);
    setHover(Math.min(pts.length - 1, Math.max(0, Math.round(fx * (pts.length - 1)))));
  };

  return (
    <div ref={ref} className="relative mt-4">
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
        width={W}
        height={H}
        className="block touch-pan-y select-none"
        role="img"
        aria-label="Cents back within a year per dollar lost, by week of the loss"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
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
          (narrow ? i === 0 || i === pts.length - 1 : i % 4 === 0 || i === pts.length - 1) ? (
            <text
              key={p.week}
              x={x(i)}
              y={H - 10}
              fontSize="12"
              textAnchor={narrow ? (i === 0 ? "start" : "end") : "middle"}
              fill="var(--muted)"
            >
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
        {!narrow && ends.map((s) => (
          <text key={s.key} x={W - P.r + 10} y={s.y + 4} fontSize="12" fill="var(--text)">
            {s.label} {cents(pts[pts.length - 1][s.key])}
          </text>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="panel pointer-events-none absolute top-10 px-3 py-2 text-sm shadow-lg"
          style={{ left: Math.max(0, Math.min(x(hover) + 12, W - 220)), width: 220 }}
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
