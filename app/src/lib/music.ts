// Background music: an original chiptune loop in A minor (Am F C G, 120 BPM, 16 s), synthesised with Web Audio
// like the sound effects: a square lead, a triangle bass, and noise drums. A look-ahead scheduler queues
// notes a quarter-second ahead so timers can't make it stutter. Off until turned on, remembered per browser,
// and silent while sound is muted. When a position nears liquidation the music sinks under a low-pass filter
// so the heartbeat comes through.

import { audio, hz, isMuted, onMuted } from "./sound";

const KEY = "oneup.music";
const VOLUME = 0.045;
const STEP = 0.25; // an eighth note at 120 BPM
const AHEAD = 0.25;

// eight eighth notes per bar, "-" holds the note before, "." rests
const LEAD = [
  "A4 C5 E5 A5 G5 E5 C5 E5", // Am
  "F5 - E5 C5 A4 - C5 -", // F
  "G4 C5 E5 G5 E5 C5 D5 E5", // C
  "D5 - B4 G4 B4 D5 G5 -", // G
  "E5 - A5 - G5 E5 D5 C5",
  "A4 C5 F5 - E5 - C5 -",
  "E5 G5 C6 - B5 G5 E5 G5",
  "D6 - B5 - G5 - . .",
].flatMap((bar) => bar.split(" "));
const ROOTS = ["A2", "F2", "C3", "G2"];
const KICK = [1, 0, 0, 0, 1, 0, 0, 0];
const SNARE = [0, 0, 1, 0, 0, 0, 1, 0];

let on = read();
let tense = false;
let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let noise: AudioBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let next = 0;
const listeners = new Set<(on: boolean) => void>();

function read() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const isMusicOn = () => on;

export function onMusic(f: (on: boolean) => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export function setMusic(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {}
  listeners.forEach((f) => f(v));
  sync();
}

/** Starts or stops the loop to match the setting and the mute. Call after a click: browsers need one. */
export function sync() {
  if (on && !isMuted()) start();
  else stop();
}

/** Muffle the music (a position near liquidation) or bring it back. */
export function setMusicTension(t: boolean) {
  tense = t;
  // only while playing: creating the audio context here, before any click, would leave it locked
  if (!filter || !master) return;
  const a = audio();
  if (!a) return;
  filter.frequency.setTargetAtTime(tense ? 700 : 12000, a.currentTime, 0.3);
  master.gain.setTargetAtTime(tense ? VOLUME * 0.6 : VOLUME, a.currentTime, 0.3);
}

function start() {
  if (timer) return;
  const a = audio();
  if (!a) return;
  filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = tense ? 700 : 12000;
  master = a.createGain();
  master.gain.setValueAtTime(0, a.currentTime);
  master.gain.linearRampToValueAtTime(tense ? VOLUME * 0.6 : VOLUME, a.currentTime + 1.5);
  master.connect(filter).connect(a.destination);
  noise ??= makeNoise(a);
  step = 0;
  next = a.currentTime + 0.1;
  timer = setInterval(() => schedule(a), 50);
  schedule(a);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  const a = audio();
  const m = master;
  if (a && m) {
    m.gain.setTargetAtTime(0, a.currentTime, 0.15);
    setTimeout(() => m.disconnect(), 800);
  }
  master = null;
  filter = null;
}

function schedule(a: AudioContext) {
  if (!master) return;
  while (next < a.currentTime + AHEAD) {
    play(a, master, step, next);
    step = (step + 1) % LEAD.length;
    next += STEP;
  }
}

function play(a: AudioContext, out: AudioNode, i: number, t: number) {
  const beat = i % 8;
  // lead: how many steps the note holds, so "-" extends it
  const n = LEAD[i];
  if (n !== "-" && n !== ".") {
    let len = 1;
    while (LEAD[(i + len) % LEAD.length] === "-") len++;
    tone(a, out, hz(n), t, len * STEP * 0.9, "square", 0.55);
  }
  // bass: root and octave on the eighths
  const root = ROOTS[Math.floor(i / 8) % ROOTS.length];
  tone(a, out, hz(root) * (beat % 2 ? 2 : 1), t, STEP * 0.8, "triangle", 1.4);
  // drums
  if (KICK[beat]) kick(a, out, t);
  if (SNARE[beat]) hit(a, out, t, 0.12, 1800, 0.9);
  hit(a, out, t, 0.03, 7000, 0.25); // hat on every eighth
}

function tone(a: AudioContext, out: AudioNode, f: number, t: number, len: number, wave: OscillatorType, gain: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.setValueAtTime(gain, t + len * 0.7);
  g.gain.linearRampToValueAtTime(0, t + len);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
}

function kick(a: AudioContext, out: AudioNode, t: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(2.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.16);
}

/** A burst of noise through a high-pass: a snare when long and low, a hat when short and high. */
function hit(a: AudioContext, out: AudioNode, t: number, len: number, cut: number, gain: number) {
  const s = a.createBufferSource();
  s.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = cut;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + len + 0.01);
}

function makeNoise(a: AudioContext) {
  const b = a.createBuffer(1, a.sampleRate * 0.2, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// muting sound mutes the music too
if (typeof window !== "undefined") onMuted(() => sync());
