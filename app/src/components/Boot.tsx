"use client";

// The power-on screen, once a browser session: a handheld with trading keys. The power light comes on, the LCD
// flickers awake, the logo drops in in pixel steps, the tagline types, then a live price line draws itself behind
// it and the markets scroll along the bottom while PRESS START blinks. Any tap, click or key starts (L and S press
// the LONG and SHORT keys on the way); with reduced motion it shows already settled.

import { useEffect, useState } from "react";
import { useOneUp } from "@/lib/oneup";
import { sfx } from "@/lib/sound";
import { Logo } from "./Pixel";
import { fmtPrice } from "./Trade";

const KEY = "oneup.booted";
/** Any page with ?boot shows it again, whatever this session has seen. */
const forced = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("boot");

/** Plays the power-on screen again (the Demo menu's "Show the intro again"). */
export function showBoot() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  location.reload();
}
const TAGLINE = "LOSE A TRADE, GET A LIFE";

export function Boot() {
  const { prices, history } = useOneUp();
  // shown until we know this session hasn't seen it, so the app never flashes underneath first
  const [state, setState] = useState<"boot" | "leaving" | "gone">("boot");
  const [typed, setTyped] = useState(0);
  const [pressed, setPressed] = useState<"long" | "short" | "start" | null>(null);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === "1" && !forced()) return setState("gone");
    } catch {}
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setTyped(TAGLINE.length);
    // the logo lands at 1.5 s, then the tagline types a letter every 45 ms
    let i = 0;
    let tick: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      tick = setInterval(() => {
        i += 1;
        setTyped(i);
        if (i >= TAGLINE.length) clearInterval(tick);
      }, 45);
    }, 1700);
    return () => {
      clearTimeout(start);
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (state !== "boot") return;
    const go = (key: "long" | "short" | "start") => {
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {}
      setPressed(key);
      sfx("boot");
      setState("leaving");
      setTimeout(() => setState("gone"), 750);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      const k = e.key.toLowerCase();
      go(k === "l" ? "long" : k === "s" ? "short" : "start");
    };
    const onPointer = (e: PointerEvent) => {
      const key = (e.target as HTMLElement).closest("[data-key]")?.getAttribute("data-key");
      go(key === "long" || key === "short" ? key : "start");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [state]);

  if (state === "gone") return null;
  // the line behind the logo: the market with the most history so far, scaled to the screen
  const pts = Object.values(history).sort((a, b) => b.length - a.length)[0]?.slice(-60) ?? [];
  const lo = Math.min(...pts.map((x) => x.p));
  const hi = Math.max(...pts.map((x) => x.p));
  const line =
    pts.length > 2
      ? pts.map((x, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * 100).toFixed(2)} ${(88 - ((x.p - lo) / (hi - lo || 1)) * 70).toFixed(2)}`).join(" ")
      : "M0 70 L15 62 L28 66 L42 48 L55 54 L68 38 L80 44 L100 26";
  const ticker = Object.entries(prices).map(([m, p]) => `${m.split("-")[0]} ${fmtPrice(p)}`);
  const tape = ticker.length ? ticker.join("   ·   ") : "NEAR   ·   BTC   ·   ETH";

  return (
    <div className={`boot ${state === "leaving" ? "boot-leave" : ""}`} role="dialog" aria-modal="true" aria-label="OneUp. Press any key or tap to start.">
      <div className="boot-console case">
        <div className="boot-top" aria-hidden>
          <span className="boot-led" />
          <span className="boot-power">POWER</span>
          <span className="boot-brand display">OneUp</span>
        </div>
        <div className="bezel boot-bezel">
          <div className="faceplate mb-3" aria-hidden>
            <span className="stripes" />
            <span className="faceplate-print">NEAR HACKATHON 2026</span>
            <span className="stripes" />
          </div>
          <div className="lcd boot-screen">
            <svg className="boot-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <path d={line} pathLength={1} />
            </svg>
            <div className="boot-logo">
              <Logo size={64} />
              <span className="display boot-word">OneUp</span>
            </div>
            <div className="display boot-tag" aria-hidden>
              {TAGLINE.slice(0, typed)}
              <span className="boot-caret">{typed < TAGLINE.length ? "▌" : ""}</span>
            </div>
            <div className={`display boot-start ${typed >= TAGLINE.length ? "on" : ""}`}>PRESS START</div>
            <div className="boot-ticker display" aria-hidden>
              <span>
                {tape}   ·   {tape}   ·   
              </span>
            </div>
          </div>
        </div>
        {/* the keys: leverage on the pad, LONG and SHORT where A and B would be */}
        <div className="boot-pad">
          <span className="boot-dpad" aria-hidden>
            <span className="boot-dpad-label">LEV</span>
          </span>
          <span className="boot-ab">
            <button type="button" data-key="short" className={`boot-key short ${pressed === "short" ? "down" : ""}`} aria-label="Short">
              <span>SHORT</span>
            </button>
            <button type="button" data-key="long" className={`boot-key long ${pressed === "long" ? "down" : ""}`} aria-label="Long">
              <span>LONG</span>
            </button>
          </span>
        </div>
        <div className="boot-pills">
          <span aria-hidden>
            <i />
            MARKET
          </span>
          <button type="button" data-key="start" className={pressed === "start" ? "down" : ""}>
            <i />
            START
          </button>
        </div>
        <div className="boot-grille" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>
      <p className="boot-hint">Tap, click or press any key · L and S press LONG and SHORT</p>
    </div>
  );
}
