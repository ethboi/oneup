// Pixel sprites drawn from character grids, outlined in ink automatically so they read on any surface.

const HEART = [
  ".##...##.",
  "####.####",
  "#########",
  "#########",
  ".#######.",
  "..#####..",
  "...###...",
  "....#....",
];

const COIN = [
  "..####..",
  ".######.",
  "###||###",
  "###||###",
  "###||###",
  "###||###",
  ".######.",
  "..####..",
];

interface SpriteProps {
  rows: string[];
  colors: Record<string, string>;
  size: number;
  /** Fraction of the shape filled from the bottom up; the rest draws in `empty`. */
  fill?: number;
  empty?: string;
  label?: string;
  className?: string;
}

function Sprite({ rows, colors, size, fill = 1, empty = "var(--panel-2)", label, className }: SpriteProps) {
  const h = rows.length;
  const w = rows[0].length;
  const on = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== ".";
  const cells: React.ReactNode[] = [];
  // outline: every empty cell (in a 1-cell margin) that touches the shape
  for (let y = -1; y <= h; y++)
    for (let x = -1; x <= w; x++)
      if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)))
        cells.push(<rect key={`o${x},${y}`} x={x + 1} y={y + 1} width="1.02" height="1.02" fill="var(--edge)" />);
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
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {cells}
    </svg>
  );
}

/** A heart, optionally part-filled from the bottom (a life's progress to Full Heal). */
export function PixelHeart({ size = 24, fill = 1, className, label }: { size?: number; fill?: number; className?: string; label?: string }) {
  const rows = HEART.map((r, y) => (y === 1 ? r.slice(0, 1) + "#" + "*" + r.slice(3) : r));
  return <Sprite rows={rows} colors={{ "#": "var(--heart)", "*": "#fff" }} size={size} fill={fill} className={className} label={label} />;
}

export function PixelCoin({ size = 18 }: { size?: number }) {
  return <Sprite rows={COIN} colors={{ "#": "var(--accent)", "|": "color-mix(in srgb, var(--accent) 60%, #7a5200)" }} size={size} />;
}

/** The OneUp mark: a heart with a +1 badge. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="relative inline-block" style={{ width: size, height: size }} aria-hidden>
      <PixelHeart size={size} />
      <span
        className="display absolute -right-2 -top-1 rounded-md border-2 border-[var(--edge)] bg-[var(--accent)] px-1 text-[11px] leading-[14px] text-[var(--on-color)]"
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
      className="flex gap-[3px] rounded-md border-2 border-[var(--edge)] bg-[var(--panel-2)] p-[3px]"
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
