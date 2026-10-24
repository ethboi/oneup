// Vibration on phones that support it (Android browsers; iPhones don't offer it to web pages): a short buzz on a
// fill, a pattern for a win, a long one for a liquidation. On by default, switched off in the sound menu, and
// remembered in this browser. Independent of sound, so a muted phone still buzzes.

import type { Sfx } from "./sound";

const KEY = "oneup.haptics";

const PATTERNS: Partial<Record<Sfx, number | number[]>> = {
  fill: 25,
  win: [30, 50, 30],
  jackpot: [60, 40, 60, 40, 120],
  lose: 60,
  liquidated: [200, 80, 200],
  levelup: [40, 40, 40, 40, 90],
  combo: [25, 30, 25],
  shield: 35,
  heal: [50, 50, 50, 50, 150],
  bigmove: 40,
};

export function hapticsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setHaptics(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  if (on) buzz("fill");
}

/** Buzzes for a sound effect that has a pattern, where the device can and the player hasn't switched it off. */
export function buzz(name: Sfx) {
  const p = PATTERNS[name];
  if (p === undefined || !hapticsOn() || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(p);
  } catch {}
}

export const canVibrate = () => typeof navigator !== "undefined" && "vibrate" in navigator;
