// Pixel sprites drawn from character grids, outlined in ink automatically so they read on any surface.

import { COIN_ROWS as COIN, HEART_ROWS as HEART, LOCK_ROWS, SPRITES, pixelText } from "@/lib/sprites";
import { MARKS, type MarkName } from "@/lib/marks";

interface SpriteProps {
  rows: string[];
  colors: Record<string, string>;
  size: number;
  /** Fraction of the shape filled from the bottom up; the rest draws in `empty`. */
  fill?: number;
  empty?: string;
  /** Outline colour (ink by default). */
  edge?: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

function Sprite({ rows, colors, size, fill = 1, empty = "var(--panel-2)", edge = "var(--edge)", label, className, style }: SpriteProps) {
  const h = rows.length;
  const w = rows[0].length;
  const on = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== ".";
  const cells: React.ReactNode[] = [];
  // outline: every empty cell (in a 1-cell margin) that touches the shape
  for (let y = -1; y <= h; y++)
    for (let x = -1; x <= w; x++)
      if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)))
        cells.push(<rect key={`o${x},${y}`} x={x + 1} y={y + 1} width="1.02" height="1.02" fill={edge} />);
  const firstFilledRow = h - Math.round(fill * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === ".") continue;
      const color = y >= firstFilledRow ? colors[c] : empty;
      cells.push(<rect key={`${x},${y}`} x={x + 1} y={y + 1} width="1.02" height="1.02" fill={color} />);
    }
  return (
    <svg
      width={size}
      height={(size * (h + 2)) / (w + 2)}
      viewBox={`0 0 ${w + 2} ${h + 2}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {cells}
    </svg>
  );
}

/** A heart, optionally part-filled from the bottom (a life's progress to Full Heal). */
/** `live`: outlined in the heart colour, for a life that's still earning. */
export function PixelHeart({ size = 24, fill = 1, live, className, label }: { size?: number; fill?: number; live?: boolean; className?: string; label?: string }) {
  const rows = HEART.map((r, y) => (y === 1 ? r.slice(0, 1) + "#" + "*" + r.slice(3) : r));
  return (
    <Sprite
      rows={rows}
      colors={{ "#": "var(--heart)", "*": "#fff" }}
      size={size}
      fill={fill}
      edge={live ? "var(--heart)" : undefined}
      empty={live ? "color-mix(in srgb, var(--heart) 14%, var(--panel))" : undefined}
      className={className}
      label={label}
    />
  );
}

export function PixelCoin({ size = 18 }: { size?: number }) {
  return <Sprite rows={COIN} colors={{ "#": "var(--accent)", "|": "color-mix(in srgb, var(--accent) 60%, #7a5200)" }} size={size} />;
}

/** A $1UP lock: a gold padlock. */
export function PixelLock({ size = 24 }: { size?: number }) {
  return <Sprite rows={LOCK_ROWS} colors={{ "#": "#6b7088", G: "var(--accent)", K: "var(--edge)" }} size={size} />;
}

/** The OneUp mark: a heart with a +1 badge. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="relative inline-block" style={{ width: size, height: size }} aria-hidden>
      <PixelHeart size={size} />
      <span
        className="display absolute -right-2 -top-1 rounded-md border border-[var(--edge)] bg-[var(--accent)] px-1 text-[11px] leading-[14px] text-[var(--on-color)]"
      >
        +1
      </span>
    </span>
  );
}

/** A segmented health bar: `segments` blocks, `value` (0–1) of them lit. */
export function HealthBar({ value, segments = 10, color = "var(--heart)", label }: { value: number; segments?: number; color?: string; label: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <div
      className="flex gap-[3px] rounded-md border border-[var(--edge)] bg-[var(--panel-2)] p-[3px]"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className="h-2.5 flex-1 rounded-[2px]" style={{ background: i < lit ? color : "transparent" }} />
      ))}
    </div>
  );
}

/** An achievement's sprite. Locked, it's a grey silhouette. */
export function PixelBadge({ id, size = 32, locked }: { id: string; size?: number; locked?: boolean }) {
  const def = SPRITES[id];
  if (!def) return null;
  const grey = "color-mix(in srgb, var(--muted) 40%, var(--panel))";
  const colors = locked ? Object.fromEntries(Object.keys(def.colors).map((k) => [k, grey])) : def.colors;
  return <Sprite rows={def.rows} colors={colors} size={size} fill={locked ? 1 : (def.fill ?? 1)} edge={locked ? "var(--muted)" : undefined} />;
}

/** An amount in the pixel font, `height` px tall, in coin gold with a highlight row, outlined in ink. Shrinks
 *  to fit narrow screens. */
export function PixelAmount({ text, height }: { text: string; height: number }) {
  return (
    <span className="num block whitespace-nowrap font-extrabold" style={{ fontSize: height * 0.82, lineHeight: 1.1, color: "#1c1b29" }}>
      {text}
    </span>
  );
}

/** A brand mark from lib/marks.ts, drawn pixel for pixel; tiled marks get rounded corners like an app icon. */
export function PixelMark({ name, size = 36, label }: { name: MarkName; size?: number; label?: string }) {
  const m = MARKS[name] as { colors: Record<string, string>; rows: string[] };
  const n = m.rows.length;
  const tiled = !m.rows[0].includes(".");
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={tiled ? { borderRadius: size * 0.22, boxShadow: "0 2px 0 rgb(0 0 0 / 0.3)" } : undefined}
    >
      {m.rows.flatMap((r, y) =>
        [...r].map((c, x) => (c === "." ? null : <rect key={`${x},${y}`} x={x} y={y} width="1.02" height="1.02" fill={m.colors[c]} />)),
      )}
    </svg>
  );
}

/** The heart, angry: slanted brows, glaring eyes and gritted teeth, with flames off its top (REVENGE TRADE). */
const ANGRY_HEART = [
  ".###...###.",
  "#####.#####",
  "#K#######K#",
  "##KK###KK##",
  "##WK###KW##",
  ".#########.",
  "..KWKWKWK..",
  "...#####...",
  "....###....",
  ".....#.....",
];
const FLAME_ROWS = ["..#..", ".##..", ".###.", "##Y##", "#YYY#", ".#Y#."];

export function AngryHeart({ size = 72 }: { size?: number }) {
  const flame = { "#": "#ff7a1a", Y: "#f2b705" };
  return (
    <span className="relative inline-block" style={{ width: size, height: size * 1.2 }} aria-hidden>
      <span className="angry-flame absolute" style={{ left: size * 0.06, top: 0 }}>
        <Sprite rows={FLAME_ROWS} colors={flame} size={size * 0.34} />
      </span>
      <span className="angry-flame absolute" style={{ right: size * 0.06, top: 0, animationDelay: "0.15s" }}>
        <Sprite rows={FLAME_ROWS} colors={flame} size={size * 0.34} />
      </span>
      <span className="absolute bottom-0 left-0">
        <Sprite rows={ANGRY_HEART} colors={{ "#": "var(--heart)", K: "var(--edge)", W: "#fff" }} size={size} />
      </span>
    </span>
  );
}

/** The market as a fighter: three red candles stepping down, wicks in ink (REVENGE TRADE's opponent). */
const FALLING_CANDLES = [
  ".K..........",
  "RRR.........",
  "RRR..K......",
  "RRR.RRR.....",
  "RRR.RRR.....",
  ".K..RRR..K..",
  "....RRR.RRR.",
  ".....K..RRR.",
  "........RRR.",
  "........RRR.",
  "........RRR.",
  ".........K..",
];

export function FallingCandles({ size = 64 }: { size?: number }) {
  return <Sprite rows={FALLING_CANDLES} colors={{ R: "#e23b3b", K: "var(--edge)" }} size={size} />;
}
