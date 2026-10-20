// Renders the fairness chart as a static SVG for the README (light theme, same palette as the app).

interface Point {
  week: number;
  oneup: number;
  oneupNoExpiry: number;
  papertrade: number;
}

const SERIES = [
  { key: "oneup", label: "OneUp", color: "#2a78d6", dash: "" },
  { key: "papertrade", label: "Papertrade-style", color: "#eb6834", dash: "" },
  { key: "oneupNoExpiry", label: "OneUp, no expiry", color: "#1baf7a", dash: "6 5" },
] as const;

export function fairnessSvg(pts: Point[]): string {
  const W = 900;
  const H = 360;
  const P = { l: 52, r: 190, t: 64, b: 40 };
  const max = Math.ceil(Math.max(...pts.flatMap((p) => [p.oneup, p.oneupNoExpiry, p.papertrade])) * 10) / 10;
  const x = (i: number) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const cents = (v: number) => `${(v * 100).toFixed(1)}¢`;
  const ticks = [0, 0.1, 0.2, 0.3].filter((t) => t <= max);
  const ends = SERIES.map((s) => ({ ...s, y: y(pts[pts.length - 1][s.key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 18);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<text x="${P.l}" y="26" font-size="17" font-weight="600" fill="#12161b">Late losers get back as much as early ones</text>`);
  out.push(`<text x="${P.l}" y="46" font-size="12.5" fill="#5d6877">USDC recovered within a year per $1 lost, by week of the loss · median of 20 simulated runs</text>`);
  for (const t of ticks) {
    out.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="#dde2e8"/>`);
    out.push(`<text x="${P.l - 8}" y="${y(t) + 4}" font-size="12" text-anchor="end" fill="#5d6877">${Math.round(t * 100)}¢</text>`);
  }
  pts.forEach((p, i) => {
    if (i % 4 === 0 || i === pts.length - 1) {
      out.push(`<text x="${x(i)}" y="${H - 14}" font-size="12" text-anchor="middle" fill="#5d6877">week ${p.week}</text>`);
    }
  });
  for (const s of SERIES) {
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[s.key]).toFixed(1)}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`);
  }
  for (const s of ends) {
    out.push(`<line x1="${W - P.r + 8}" x2="${W - P.r + 24}" y1="${s.y}" y2="${s.y}" stroke="${s.color}" stroke-width="2.5"${s.dash ? ` stroke-dasharray="4 3"` : ""}/>`);
    out.push(`<text x="${W - P.r + 30}" y="${s.y + 4}" font-size="12.5" fill="#12161b">${s.label} ${cents(pts[pts.length - 1][s.key])}</text>`);
  }
  out.push("</svg>");
  return out.join("\n");
}
