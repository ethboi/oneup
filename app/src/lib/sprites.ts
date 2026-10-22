// Pixel sprites for the achievements, in the same character-grid style as the heart and coin
// (components/Pixel.tsx draws them, outlined in ink). "." is empty; every other character is a colour key
// from the sprite's palette. Each badge maps to a sprite and, optionally, a fill (a part-empty heart).

export interface SpriteDef {
  rows: string[];
  colors: Record<string, string>;
  /** Fraction filled from the bottom up (the heart's progress style). */
  fill?: number;
}

const INK = "var(--edge)";
const WHITE = "#fff";
const GOLD = "var(--accent)";
const GOLD_DARK = "color-mix(in srgb, var(--accent) 60%, #7a5200)";
const HEART = "var(--heart)";
const LONG = "var(--long)";
const SHORT = "var(--short)";
const BLUE = "var(--info)";
const BROWN = "#9a6332";
const ICE = "#8fd3ff";
const FLAME = "#ff7a1a";
/** For dark parts that stand alone (a stick, a floor): ink would vanish on a dark tile. */
const STEEL = "#6b7088";

export const HEART_ROWS = [".##...##.", "####.####", "#########", "#########", ".#######.", "..#####..", "...###...", "....#...."];
/** The heart with its white shine, as the brand draws it. */
const SHINY_HEART = HEART_ROWS.map((r, y) => (y === 1 ? r.slice(0, 1) + "#" + "*" + r.slice(3) : r));
export const COIN_ROWS = ["..####..", ".######.", "###||###", "###||###", "###||###", "###||###", ".######.", "..####.."];

const heart = (color: string, fill?: number): SpriteDef => ({ rows: SHINY_HEART, colors: { "#": color, "*": WHITE }, fill });
const flame = (outer: string, inner: string): SpriteDef => ({
  rows: ["...#.....", "...##....", "..###.#..", ".####.##.", ".#######.", "##YY#####", "#YYYY####", "#YYYYY##.", ".#YYY##.."],
  colors: { "#": outer, Y: inner },
});

export const SPRITES: Record<string, SpriteDef> = {
  // Trading
  player1: {
    rows: ["...RR....", "..RRRR...", "..RRRR...", "...RR....", "....K....", "....K....", "..#####..", ".#######.", "#########"],
    colors: { R: SHORT, K: STEEL, "#": BLUE },
  },
  regular: {
    // three candles: up, down, up
    rows: [".........L.", ".L.......L.", "LLL.....LLL", "LLL..S..LLL", "LLL.SSS.LLL", ".L..SSS..L.", "....SSS....", ".....S....."],
    colors: { L: LONG, S: SHORT },
  },
  centurion: {
    rows: ["#########", "#.#W###.#", "#.#W###.#", ".#######.", "..#####..", "...###...", "....#....", "..#####..", "..DDDDD.."],
    colors: { "#": GOLD, W: WHITE, D: GOLD_DARK },
  },
  globetrotter: {
    rows: ["..#####..", ".#LL##L#.", "#LLL##LL#", "#LL####L#", "##L###LL#", "###L#LL##", ".##LL###.", "..#####.."],
    colors: { "#": BLUE, L: LONG },
  },
  switch: {
    rows: ["..L......", ".LLL.....", "LLLLL....", ".LLL.....", ".LLL.SSS.", ".LLL.SSS.", ".....SSS.", "....SSSSS", ".....SSS.", "......S.."],
    colors: { L: LONG, S: SHORT },
  },
  sharpshooter: {
    rows: ["..#####..", ".#WWWWW#.", "#WW###WW#", "#W#WWW#W#", "#W#W#W#W#", "#W#WWW#W#", "#WW###WW#", ".#WWWWW#.", "..#####.."],
    colors: { "#": SHORT, W: WHITE },
  },
  stopped: {
    rows: ["..#####..", ".#######.", "#########", "#WWWWWWW#", "#WWWWWWW#", "#########", ".#######.", "..#####.."],
    colors: { "#": SHORT, W: WHITE },
  },
  paperhands: {
    rows: ["WWWWF..", "WWWWFF.", "WWWWWWW", "WKKKKKW", "WWWWWWW", "WKKKKKW", "WWWWWWW", "WKKKWWW", "WWWWWWW"],
    colors: { W: WHITE, F: "#cfd3dc", K: "#8a8fa6" },
  },
  hodl: {
    rows: ["#######", ".#WWW#.", "..#G#..", "...#...", "..#W#..", ".#GGG#.", "#######"],
    colors: { "#": BROWN, W: "#e8f4ff", G: GOLD },
  },
  degen: {
    rows: ["#######", "#K###K#", "#######", "###K###", "#######", "#K###K#", "#######"],
    colors: { "#": WHITE, K: INK },
  },
  whale: {
    rows: ["........#.#", ".........#.", "..######.#.", ".########..", "#W#########", "###########", ".#########.", "..######..."],
    colors: { "#": BLUE, W: WHITE },
  },
  moon: {
    rows: ["...####.", ".####...", "####....", "###.....", "###.....", "####....", ".####...", "...####."],
    colors: { "#": GOLD },
  },
  bigwin: {
    rows: ["..K.K..", "...#...", "..###..", ".#####.", "###G###", "##GGG##", "###G###", ".#####."],
    colors: { "#": BROWN, G: GOLD, K: STEEL },
  },
  maxwin: {
    rows: ["#...#...#", "##.###.##", "#########", "#R##B##R#", "#########"],
    colors: { "#": GOLD, R: SHORT, B: BLUE },
  },
  // Streaks
  hot3: flame(FLAME, GOLD),
  fire5: flame(BLUE, ICE),
  cold3: {
    rows: ["....#....", ".#..#..#.", "..#.#.#..", "...###...", "#########", "...###...", "..#.#.#..", ".#..#..#.", "....#...."],
    colors: { "#": ICE },
  },
  bottom5: {
    rows: ["..SSS..", "..SSS..", "..SSS..", "SSSSSSS", ".SSSSS.", "..SSS..", "...S...", "KKKKKKK"],
    colors: { S: SHORT, K: STEEL },
  },
  comeback: {
    rows: ["...L...", "..LLL..", ".LLLLL.", "LLLLLLL", "..LLL..", "..LLL..", "..LLL..", "KKKKKKK"],
    colors: { L: LONG, K: STEEL },
  },
  // Losses
  rekt: {
    // the heart, cracked down the middle
    rows: [".##...##.", "####.####", "####.####", "###.#####", ".###.###.", "..##.##..", "...#.#...", "....#...."],
    colors: { "#": HEART },
  },
  serialrekt: {
    rows: [".#####.", "#######", "#KK#KK#", "#KK#KK#", "###K###", ".#####.", ".#.#.#."],
    colors: { "#": WHITE, K: INK },
  },
  ouch: {
    rows: ["..#######..", ".##W#W#W##.", "###WWWWW###", ".##W#W#W##.", "..#######.."],
    colors: { "#": "#e8b48a", W: WHITE },
  },
  tilted: {
    rows: ["...W...", "..RRR..", ".RRWRR.", ".RRRRR.", ".RRRRR.", "KKKKKKK", "KKKKKKK"],
    colors: { R: SHORT, W: WHITE, K: STEEL },
  },
  revengetrader: {
    rows: ["........W", ".......WW", "......WW.", ".....WW..", "..#.WW...", "...#W....", "...G#....", "..G..#...", ".G......."],
    colors: { W: "#dfe6f0", "#": GOLD, G: BROWN },
  },
  clutch: heart(HEART, 0.25),
  // Lives & locks
  oneup: heart(HEART),
  collector: {
    rows: [".#.#...#.#...#.#.", "#####.#####.#####", "#####.#####.#####", ".###...###...###.", "..#.....#.....#.."],
    colors: { "#": HEART },
  },
  payback: { rows: COIN_ROWS, colors: { "#": GOLD, "|": GOLD_DARK } },
  fullheal: heart(GOLD),
  diamond: {
    rows: [".#######.", "##W#W####", "#########", ".#######.", "..#####..", "...###...", "....#...."],
    colors: { "#": ICE, W: WHITE },
  },
  trader: {
    rows: ["..######", ".#W#####", "########", "########", ".#######", "..######"],
    colors: { "#": GOLD, W: WHITE },
  },
  exit: {
    rows: ["######", "#BBBB#", "#BBBB#", "#BBGB#", "#BBBB#", "#BBBB#", "######"],
    colors: { "#": STEEL, B: BROWN, G: GOLD },
  },
  backer: heart(BLUE),
};
