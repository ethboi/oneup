// A Life NFT's image, drawn as the contract draws it (heart_svg in contracts/extra-life/src/lib.rs): a pixel
// heart on an LCD tile, filled from the bottom by paid / owed, gold behind a Full Heal or a Backer Life, grey once
// expired. The same data: URI a wallet shows.

const HEART = [".##...##.", "#*#######", "#########", "#########", ".#######.", "..#####..", "...###...", "....#...."];
/** background, heart, empty rows */
const COLORS = {
  earning: ["b4f7c8", "e2257a", "6fe29a"],
  full_heal: ["f2b705", "e2257a", "e2257a"],
  expired: ["c9cbd4", "8a8c99", "a9abb6"],
} as const;

export type LifeState = keyof typeof COLORS;

/** How many of the heart's eight rows are filled, rounded up as the contract does. */
export function lifeRows(paid: bigint, owed: bigint): number {
  const rows = BigInt(HEART.length);
  if (owed === 0n) return HEART.length;
  return Number(((paid < owed ? paid : owed) * rows + owed - 1n) / owed);
}

export function lifeImage(paid: bigint, owed: bigint, state: LifeState, backer = false): string {
  const filled = lifeRows(paid, owed);
  // a Backer Life is gold from the start, its heart filling as it is paid
  const [bg, heart, empty] = backer && state === "earning" ? (["f2b705", "e2257a", "b98b00"] as const) : COLORS[state];
  const ink = "1c1b29";
  const on = (x: number, y: number) => x >= 0 && x < 9 && y >= 0 && y < 8 && HEART[y][x] !== ".";
  let cells = "";
  // the ink outline: empty cells touching the heart
  for (let y = -1; y <= 8; y++)
    for (let x = -1; x <= 9; x++)
      if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) cells += `<rect x='${x + 2}' y='${y + 2}' width='1' height='1' fill='%23${ink}'/>`;
  HEART.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === ".") return;
      const fill = c === "*" ? "ffffff" : HEART.length - y <= filled ? heart : empty;
      cells += `<rect x='${x + 2}' y='${y + 2}' width='1' height='1' fill='%23${fill}'/>`;
    }),
  );
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 13 12' shape-rendering='crispEdges'><rect width='13' height='12' fill='%23${bg}'/>${cells}</svg>`;
}
