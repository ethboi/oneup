"use client";

// Light or dark: dark until you pick light (per browser). It's a data-theme on <html>, set before the first
// paint by the script in app/layout.tsx so the page never flashes; without that script the device's setting
// decides (globals.css).

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_KEY = "oneup.theme";

const listeners = new Set<(t: Theme) => void>();

/** The theme showing now: a pick if there is one, else the device's. */
export function currentTheme(): Theme {
  const picked = document.documentElement.dataset.theme;
  if (picked === "light" || picked === "dark") return picked;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {}
  listeners.forEach((f) => f(t));
}

export function onTheme(f: (t: Theme) => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** The theme showing, kept in step with a pick made anywhere on the page. */
export function useTheme(): Theme {
  const [theme, set] = useState<Theme>("light");
  useEffect(() => {
    set(currentTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => set(currentTheme());
    media.addEventListener("change", follow);
    const off = onTheme(set);
    return () => {
      media.removeEventListener("change", follow);
      off();
    };
  }, []);
  return theme;
}
