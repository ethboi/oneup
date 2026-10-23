// TILT, as in pinball: three losing trades within ten minutes and the screen flashes TILT for a minute. It
// only says so; nothing is locked. Also remembers the last loss, so a trade opened soon after it can be
// called out as a revenge trade. Per account, in this browser.

import { useEffect, useState } from "react";

const WINDOW_MS = 10 * 60_000;
/** A position opened within this long of a losing close is a revenge trade. */
export const REVENGE_MS = 2 * 60_000;
const LOSSES = 3;
export const TILT_MS = 60_000;

const key = (account: string) => `oneup.tilt.${account}`;

function read(account: string): { losses: number[]; until: number; last: number } {
  try {
    return { last: 0, ...(JSON.parse(localStorage.getItem(key(account)) ?? "") as { losses: number[]; until: number }) };
  } catch {
    return { losses: [], until: 0, last: 0 };
  }
}

/** When this account last closed a trade at a loss (ms), or 0. */
export const lastLossAt = (account: string) => read(account).last;

/** Records a losing close; returns true when it tips the machine into TILT. */
export function recordLoss(account: string, now = Date.now()): boolean {
  const s = read(account);
  const losses = s.losses.filter((t) => now - t < WINDOW_MS).concat(now);
  let until = s.until;
  const tilted = losses.length >= LOSSES && now >= s.until;
  if (tilted) until = now + TILT_MS;
  try {
    // a tilt uses up the losses that caused it
    localStorage.setItem(key(account), JSON.stringify({ losses: tilted ? [] : losses, until, last: now }));
  } catch {}
  window.dispatchEvent(new Event("oneup-tilt"));
  return tilted;
}

/** Seconds of TILT left for this account (0 when not tilted). */
export function useTilt(account: string): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((read(account).until - Date.now()) / 1000)));
    tick();
    const i = setInterval(tick, 500);
    window.addEventListener("oneup-tilt", tick);
    return () => {
      clearInterval(i);
      window.removeEventListener("oneup-tilt", tick);
    };
  }, [account]);
  return left;
}

/** The Demo menu's preview: TILT for a few seconds, without touching the losses that count toward a real one. */
export function previewTilt(account: string, ms = 6000) {
  const s = read(account);
  try {
    localStorage.setItem(key(account), JSON.stringify({ ...s, until: Date.now() + ms }));
  } catch {}
  window.dispatchEvent(new Event("oneup-tilt"));
}
