// A $1UP lock's picture, in the style of a Life NFT's (lifeArt.ts): a pixel padlock on an LCD tile. Its gold body
// drains from the top as the unlock nears, the way a Life's heart fills as it pays. The shackle opens once it can be
// unlocked, and it goes grey once closed. The same picture the lock contract draws (lock_svg in contracts/ve/src/lib.rs).

const LOCKED = ["..#####..", ".##...##.", ".#.....#.", ".#.....#.", "GGGGGGGGG", "GGGGKGGGG", "GGGKKKGGG", "GGGGKGGGG", "GGGGGGGGG"];
/** The shackle lifted free on its left side. */
const OPEN = ["..#####..", ".##...##.", ".#.....#.", ".......#.", ...LOCKED.slice(4)];
const BODY_ROWS = 5;

/** background, shackle, gold, drained gold */
const COLORS = {
  locked: ["a8cbd0", "4f5570", "f2b705", "7fa9b0"],
  ready: ["b7c49a", "4f5570", "f2b705", "f2b705"],
  closed: ["c9cbd4", "8a8c99", "a9abb6", "a9abb6"],
} as const;

export type LockState = keyof typeof COLORS;

/** How much of `of` is left, in `parts`, rounded up: a lock with any time left never reads empty. */
export function partsLeft(left: number, of: number, parts: number): number {
  if (of <= 0 || left <= 0) return 0;
  return Math.min(parts, Math.ceil((left / of) * parts));
}

export function lockImage(left: number, of: number, state: LockState): string {
  const rows = state === "ready" ? OPEN : LOCKED;
  const [bg, shackle, gold, drained] = COLORS[state];
  const filled = state === "locked" ? partsLeft(left, of, BODY_ROWS) : BODY_ROWS;
  const ink = "1c1b29";
  const on = (x: number, y: number) => x >= 0 && x < 9 && y >= 0 && y < rows.length && rows[y][x] !== ".";
  const rect = (x: number, y: number, fill: string) => `<rect x='${x + 2}' y='${y + 2}' width='1' height='1' fill='%23${fill}'/>`;
  let cells = "";
  for (let y = -1; y <= rows.length; y++)
    for (let x = -1; x <= 9; x++)
      if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) cells += rect(x, y, ink);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === ".") return;
      cells += rect(x, y, c === "#" ? shackle : c === "K" ? ink : rows.length - y <= filled ? gold : drained);
    }),
  );
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 13 13' shape-rendering='crispEdges'><rect width='13' height='13' fill='%23${bg}'/>${cells}</svg>`;
}
