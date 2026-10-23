"use client";

// The power-on screen, once a browser session: the console's LCD lights, the logo drops in in pixel steps, the
// tagline types out, and PRESS START blinks until a tap, click or key. Skippable at once; with reduced motion it
// shows already settled.

import { useEffect, useState } from "react";
import { sfx } from "@/lib/sound";
import { Logo } from "./Pixel";

const KEY = "oneup.booted";
const TAGLINE = "LOSE A TRADE, GET A LIFE";

export function Boot() {
  // shown until we know this session hasn't seen it, so the app never flashes underneath first
  const [state, setState] = useState<"boot" | "leaving" | "gone">("boot");
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === "1") return setState("gone");
    } catch {}
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) return setTyped(TAGLINE.length);
    // the logo lands at 1.3 s, then the tagline types a letter every 45 ms
    let i = 0;
    let tick: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      tick = setInterval(() => {
        i += 1;
        setTyped(i);
        if (i >= TAGLINE.length) clearInterval(tick);
      }, 45);
    }, 1500);
    return () => {
      clearTimeout(start);
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (state !== "boot") return;
    const go = () => {
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {}
      sfx("boot");
      setState("leaving");
      setTimeout(() => setState("gone"), 650);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      go();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", go);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", go);
    };
  }, [state]);

  if (state === "gone") return null;
  return (
    <div className={`boot ${state === "leaving" ? "boot-leave" : ""}`} role="dialog" aria-modal="true" aria-label="OneUp. Press any key or tap to start.">
      <div className="boot-console case">
        <div className="bezel px-4 pb-6 pt-4 sm:px-7">
          <div className="faceplate mb-3" aria-hidden>
            <span className="stripes" />
            <span className="faceplate-print">NEAR HACKATHON 2026</span>
            <span className="stripes" />
          </div>
          <div className="lcd boot-screen">
            <div className="boot-logo">
              <Logo size={56} />
              <span className="display boot-word">OneUp</span>
            </div>
            <div className="display boot-tag" aria-hidden>
              {TAGLINE.slice(0, typed)}
              <span className="boot-caret">{typed < TAGLINE.length ? "▌" : ""}</span>
            </div>
            <div className={`display boot-start ${typed >= TAGLINE.length ? "on" : ""}`}>PRESS START</div>
          </div>
        </div>
        {/* the console's buttons, for show: the A and B keys and the start pill */}
        <div className="boot-pad" aria-hidden>
          <span className="boot-dpad" />
          <span className="boot-ab">
            <span>B</span>
            <span>A</span>
          </span>
        </div>
        <div className="boot-pills" aria-hidden>
          <span>SELECT</span>
          <span className="boot-pill-start">START</span>
        </div>
      </div>
      <p className="boot-hint">Tap, click or press any key</p>
    </div>
  );
}
