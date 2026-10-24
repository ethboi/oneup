// Sound effects, synthesised with Web Audio: square and triangle blips in the console's spirit, no audio
// files. Browsers only allow sound after the page has been interacted with, so the context is created on
// first use (always after a click here). Muting is per browser.

export type Sfx = "send" | "fill" | "win" | "jackpot" | "lose" | "liquidated" | "plusOne" | "life" | "claim" | "error" | "tilt" | "badge" | "heal" | "round" | "revenge" | "boot" | "levelup" | "combo" | "shield" | "coin" | "bigmove";

import { buzz } from "./haptics";

const KEY = "oneup.muted";
const VOLUME = 0.12;

let ctx: AudioContext | null = null;
let muted = read();
const listeners = new Set<(m: boolean) => void>();

function read() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const isMuted = () => muted;

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {}
  listeners.forEach((f) => f(m));
}

export function onMuted(f: (m: boolean) => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Set by the first tap, click or key. A context made before that starts locked, and iOS may keep it so. */
let touched = false;
if (typeof window !== "undefined") {
  const mark = () => (touched = true);
  for (const e of ["pointerdown", "keydown", "touchend"]) window.addEventListener(e, mark, { once: true, capture: true });
}

export function audio(): AudioContext | null {
  if (typeof window === "undefined" || (!ctx && !touched)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "E6" → Hz. */
export const hz = (n: string) => 440 * 2 ** ((NOTE[n[0]] + (n[1] === "#" ? 1 : 0) + 12 * (Number(n.slice(-1)) + 1) - 69) / 12);

interface Tone {
  note?: string;
  freq?: number;
  /** Slide to this frequency over the tone. */
  to?: number;
  at: number;
  len: number;
  wave?: OscillatorType;
  gain?: number;
}

function play(tones: Tone[]) {
  if (muted) return;
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.01;
  for (const t of tones) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = t.wave ?? "square";
    const f = t.freq ?? hz(t.note!);
    o.frequency.setValueAtTime(f, t0 + t.at);
    if (t.to) o.frequency.exponentialRampToValueAtTime(t.to, t0 + t.at + t.len);
    // a quick attack and a short decay, so notes click in like a handheld's
    const v = VOLUME * (t.gain ?? 1);
    g.gain.setValueAtTime(0, t0 + t.at);
    g.gain.linearRampToValueAtTime(v, t0 + t.at + 0.005);
    g.gain.setValueAtTime(v, t0 + t.at + t.len * 0.6);
    g.gain.linearRampToValueAtTime(0, t0 + t.at + t.len);
    o.connect(g).connect(a.destination);
    o.start(t0 + t.at);
    o.stop(t0 + t.at + t.len + 0.02);
  }
}

/** Notes one after another, each `step` seconds. */
const run = (notes: string[], step: number, wave?: OscillatorType, gain?: number, at = 0): Tone[] =>
  notes.map((note, i) => ({ note, at: at + i * step, len: step * 0.95, wave, gain }));

const SOUNDS: Record<Sfx, () => Tone[]> = {
  send: () => [{ note: "A5", at: 0, len: 0.04, gain: 0.6 }, { note: "E6", at: 0.05, len: 0.05, gain: 0.6 }],
  fill: () => [{ note: "B5", at: 0, len: 0.07 }, { note: "E6", at: 0.07, len: 0.22 }],
  win: () => run(["C5", "E5", "G5", "C6"], 0.07).concat({ note: "G6", at: 0.28, len: 0.25 }),
  // a huge win: the win run, then a coin-shower of high notes and a held chord
  jackpot: () =>
    run(["C5", "E5", "G5", "C6", "E6", "G6"], 0.06).concat(
      run(["C7", "G6", "C7", "G6", "C7"], 0.05, "square", 0.6, 0.4),
      { note: "C6", at: 0.7, len: 0.6, gain: 0.8 },
      { note: "E6", at: 0.7, len: 0.6, gain: 0.7 },
      { note: "G6", at: 0.7, len: 0.6, gain: 0.7 },
    ),
  lose: () => run(["G4", "D#4", "C4"], 0.14, "triangle", 1.6),
  liquidated: () => [{ freq: 520, to: 70, at: 0, len: 0.6, gain: 0.8 }],
  // the hopeful turn after a loss: the Extra Life is on its way
  plusOne: () => run(["C6", "G6"], 0.08, "square", 0.8, 0.3),
  life: () => run(["E5", "G5", "C6", "E6", "G6"], 0.08).concat({ note: "C7", at: 0.4, len: 0.3, gain: 0.8 }),
  claim: () => [
    { note: "B5", at: 0, len: 0.06 },
    { note: "E6", at: 0.06, len: 0.12 },
    { note: "B5", at: 0.2, len: 0.06 },
    { note: "E6", at: 0.26, len: 0.18 },
  ],
  error: () => [{ freq: 110, at: 0, len: 0.12 }, { freq: 98, at: 0.13, len: 0.18 }],
  // a pinball machine's tilt buzzer
  tilt: () => [0, 0.18, 0.36].map((at) => ({ freq: 140, at, len: 0.13, gain: 1.2 })),
  // an arcade "here we go": low, then a sharp rise
  revenge: () => [{ freq: 220, to: 880, at: 0, len: 0.25, gain: 0.9 }, { note: "A5", at: 0.27, len: 0.08 }, { note: "A5", at: 0.38, len: 0.15 }],
  badge: () => run(["G5", "C6", "E6"], 0.06).concat({ note: "G6", at: 0.18, len: 0.3, gain: 0.9 }),
  heal: () =>
    run(["C5", "E5", "G5", "C6", "E6", "G6", "C7"], 0.07).concat(
      { note: "E6", at: 0.5, len: 0.12, wave: "triangle", gain: 1.2 },
      { note: "G6", at: 0.62, len: 0.12, wave: "triangle", gain: 1.2 },
      { note: "C7", at: 0.74, len: 0.45, gain: 0.9 },
    ),
  // round over: a short fanfare
  // the start chime: two quick high notes, then a held one, as a handheld does when it boots
  boot: () => run(["B5", "E6"], 0.07, "square", 0.7).concat({ note: "B6", at: 0.16, len: 0.4, gain: 0.7 }),
  // the game layer (components/Game.tsx)
  levelup: () => run(["C5", "E5", "G5", "C6", "E6", "G6"], 0.06).concat({ note: "C7", at: 0.36, len: 0.4 }),
  combo: () => run(["E6", "G6", "B6"], 0.05, "square", 0.7),
  shield: () => run(["G4", "D5", "G5"], 0.06, "triangle", 0.9),
  coin: () => [{ note: "B6", at: 0, len: 0.05, gain: 0.35 }, { note: "E7", at: 0.05, len: 0.12, gain: 0.35 }],
  bigmove: () => run(["C4", "C5"], 0.08, "sawtooth", 0.5),
  round: () => run(["G4", "C5", "E5", "G5"], 0.09, "square", 0.8).concat({ note: "C6", at: 0.36, len: 0.35, gain: 0.8 }),
};

export function sfx(name: Sfx) {
  // tests read which effects played (headless browsers can't listen)
  (globalThis as { __sfx?: string[] }).__sfx?.push(name);
  // phones also buzz, sound or not (lib/haptics.ts)
  buzz(name);
  try {
    play(SOUNDS[name]());
  } catch {
    // no audio here: carry on silently
  }
}

// Tension cues for the chart, played on a loop by the console while a position is near liquidation or its
// take-profit (components/Mood.tsx). Each call is one beat.

/** Lub-dub: two low thumps. */
export function heartbeat() {
  try {
    play([
      { freq: 62, to: 40, at: 0, len: 0.11, wave: "sine", gain: 3.5 },
      { freq: 55, to: 36, at: 0.16, len: 0.13, wave: "sine", gain: 2.8 },
    ]);
  } catch {}
}

/** The low-HP alarm: a short high beep. */
export function lowHpBeep() {
  try {
    play([{ note: "B5", at: 0, len: 0.07, gain: 0.45 }]);
  } catch {}
}

/** A bright tick that climbs as the price nears the target (`progress` 0–1). */
export function shimmer(progress: number) {
  try {
    const base = 880 * 2 ** (progress * 1.5);
    play([
      { freq: base, at: 0, len: 0.05, wave: "triangle", gain: 0.7 },
      { freq: base * 1.5, at: 0.05, len: 0.06, wave: "triangle", gain: 0.5 },
    ]);
  } catch {}
}
