// Brand marks for the Built on NEAR section, pixelated from each project's own published logo (sources below)
// onto a small grid: rows of palette letters, "." for clear. "currentColor" follows the text colour.

export interface PixelMark {
  colors: Record<string, string>;
  rows: string[];
}

export const MARKS = {
  /** From near.org (its site icon). */
  near: {"colors": {"f": "#000000", "b": "#ffffff"}, "rows": ["bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbffbbbbbbffbbb", "bbbfffbbbbfffbbb", "bbbffffbbbfffbbb", "bbbffbffbfbffbbb", "bbbffbbffbbffbbb", "bbbffbbffbbffbbb", "bbbffbfbffbffbbb", "bbbfffbbbffffbbb", "bbbfffbbbbfffbbb", "bbbffbbbbbbffbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb"]},
  /** From near-intents.org (its site icon). */
  intents: {"colors": {"f": "#000000", "g": "#4fd394", "w": "#ffffff"}, "rows": ["ggggggggwwwwwwww", "ggggggggwwwwwwww", "ggggggggwwwwwwww", "ggggggggwwwwwwww", "ggggffggwwffwwww", "ggggfffgwwffwwww", "ggggfgffwfwfwwww", "ggggfggfwwwfwwww", "wwwwfwwwfggfgggg", "wwwwfwfwffgfgggg", "wwwwffwwgfffgggg", "wwwwffwwggffgggg", "wwwwwwwwgggggggg", "wwwwwwwwgggggggg", "wwwwwwwwgggggggg", "wwwwwwwwgggggggg"]},
  /** From pyth.network/brand (its site icon). */
  pyth: {"colors": {"f": "#ffffff", "b": "#7142cf"}, "rows": ["bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbffffbbbbbb", "bbbbbfbbbbfbbbbb", "bbbbffffffffbbbb", "bbbbfbfbbfbfbbbb", "bbbbfbfbffffbbbb", "bbbbfbfbbbfbbbbb", "bbbbfbfbffbbbbbb", "bbbbbbfbbbbbbbbb", "bbbbbbfbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb"]},
  /** From outlayer.fastnear.com (its site icon). */
  outlayer: {"colors": {"f": "#ffffff", "b": "#cc6600"}, "rows": ["bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbfbbbbfbbbbbbb", "bbbfffbbffffbbbb", "bbbbbfffbbfffbbb", "bbbbbfffbbfffbbb", "bbbffffbffffbbbb", "bbbfbbbbfbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb"]},
  /** From rhea.finance (its site logo). */
  rhea: {"colors": {"f": "#00d68f"}, "rows": ["....................", "......f......f......", "...ff.f......f.ff...", "...f..f...f..f..f...", "..f.ff..f.ff..ff.f..", ".fff.f.fffff..f.fff.", "...ff.ff.ff.fffff...", ".f..ffff....ffff..f.", "..f..f.f.ff.f.f..f..", "ff.f.f..ff.f..f.f.ff", "f.ff..fff...f...ff.f", ".f..f..f....ff.f..f.", "..f.fff......fff.f..", "..ff..ffff.fff..ff..", ".ff..ff.f..f.ff..ff.", "...ff..f.ff.f.fff...", ".....ff..ff..ff.....", "......ffffffff......", "........f..f........", "...................."]},
  /** From rust-lang.org (its logo). */
  rust: {"colors": {"f": "currentColor"}, "rows": ["..................", ".....ffffffff.....", "....fff.ff.fff....", "...ff........ff...", "..fff.........ff..", ".ffffffffffff..ff.", ".f.fffff..fff...f.", ".f.f.fff..fff.f.ff", ".f...fffffff....f.", ".f...fff.ffff..ff.", ".ff..ff...fff..fff", ".ffffffff..ffffff.", ".ffffffff..ffffff.", "..ff..........ff..", "...f..........f...", "....ffff..ffff....", ".....ffffffff.....", ".......f..f......."]},
  /** From drawn here: no official Sputnik DAO logo was found. */
  dao: {"colors": {"b": "#2b3a67", "f": "#ffffff", "v": "#f2b705"}, "rows": ["bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "bbbbbbvvvvbbbbbb", "bbbbbbvbbvbbbbbb", "bbbbbbvbbvbbbbbb", "bbbbbbvbbvbbbbbb", "bbbffffffffffbbb", "bbbfbbbbbbbbfbbb", "bbbfbffffffbfbbb", "bbbfbbbbbbbbfbbb", "bbbfbbbbbbbbfbbb", "bbbfbbbbbbbbfbbb", "bbbfbbbbbbbbfbbb", "bbbffffffffffbbb", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb"]},
} satisfies Record<string, PixelMark>;

export type MarkName = keyof typeof MARKS;
