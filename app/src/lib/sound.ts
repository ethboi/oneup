// Sound effects, synthesised with Web Audio: square and triangle blips in the console's spirit, no audio
// files. Browsers only allow sound after the page has been interacted with, so the context is created on
// first use (always after a click here). Muting is per browser.

export type Sfx = "send" | "fill" | "win" | "lose" | "liquidated" | "plusOne" | "life" | "claim" | "error";

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

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "E6" → Hz. */
const hz = (n: string) => 440 * 2 ** ((NOTE[n[0]] + (n[1] === "#" ? 1 : 0) + 12 * (Number(n.slice(-1)) + 1) - 69) / 12);

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
};

export function sfx(name: Sfx) {
  // tests read which effects played (headless browsers can't listen)
  (globalThis as { __sfx?: string[] }).__sfx?.push(name);
  try {
    play(SOUNDS[name]());
  } catch {
    // no audio here: carry on silently
  }
}
