"use client";

// The power-on screen, once a browser session and only at the app's root: a handheld with trading keys. The power light comes on, the LCD
// flickers awake, the logo drops in in pixel steps, the tagline types, then a live price line draws itself behind
// it and the markets scroll along the bottom while VIEW MARKETS blinks, and Life NFT cards are dealt out from
// behind the console (around it on a wide screen, fanned above it on a tall one); they tilt toward the pointer.
// Any tap, click or key starts (L and S press the LONG and SHORT keys on the way); with reduced motion it shows
// already settled. Automated browsers (a reviewer's Playwright or Puppeteer run) go straight to the app.

import { useEffect, useRef, useState } from "react";
import { automated } from "@/lib/automation";
import type { LifeState } from "@/lib/lifeArt";
import { useOneUp } from "@/lib/oneup";
import { sfx } from "@/lib/sound";
import { LifeCard } from "./LifeCard";
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

type Card = { id: number; trade?: [market: string, side: "long" | "short", leverage: number]; paid: number; owed: number; state: LifeState };
/** The cards around the console: sample Life NFTs, each naming the losing trade it came from (no trade: a Backer
 *  Life). Illustrations drawn as the contract draws a Life, not chain data. Places are in globals.css. */
const CARDS: Card[] = [
  { id: 127, trade: ["NEAR", "long", 50], paid: 112, owed: 300, state: "earning" },
  { id: 9, trade: ["NEAR", "short", 20], paid: 45, owed: 90, state: "expired" },
  { id: 219, trade: ["ETH", "long", 1000], paid: 30, owed: 240, state: "earning" },
  { id: 311, trade: ["BTC", "short", 100], paid: 600, owed: 600, state: "full_heal" },
  { id: 42, paid: 1300, owed: 2000, state: "earning" },
  { id: 256, trade: ["ETH", "short", 200], paid: 160, owed: 220, state: "earning" },
];
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

function SampleCard({ card, i }: { card: Card; i: number }) {
  const { id, trade, paid, owed, state } = card;
  return (
    <div className="boot-nft" style={{ "--i": i } as React.CSSProperties}>
      <LifeCard
        id={String(id)}
        paid={BigInt(paid)}
        owed={BigInt(owed)}
        state={state}
        backer={!trade}
        tone={trade?.[1] ?? "backer"}
        tag={trade ? trade[1].toUpperCase() : "BACKER"}
        detail={trade ? `${trade[0]} ${trade[2]}×` : "House pool"}
        amount={`${usd(paid)} / ${usd(owed)}`}
      />
    </div>
  );
}

/** The rise on the power-on screen until real prices have history: each number is a close, higher up the screen is lower. */
const SAMPLE = [66, 60, 63, 54, 58, 49, 52, 44, 48, 55, 47, 40, 44, 35, 39, 47, 41, 32, 36, 27, 31, 22, 26, 18];

/** Up to 24 candles from a market's recent prices, in the chart's 0 to 100, with 0 at the top. */
function toCandles(points: { p: number }[]) {
  const size = Math.max(1, Math.floor(points.length / 24));
  const buckets: number[][] = [];
  for (let i = Math.max(0, points.length - 24 * size); i < points.length; i += size) buckets.push(points.slice(i, i + size).map((x) => x.p));
  if (buckets.length < 12 || new Set(points.slice(-48).map((x) => x.p)).size < 4) {
    return SAMPLE.map((c, i) => {
      const o = SAMPLE[i - 1] ?? c + 5;
      return { o, c, h: Math.min(o, c) - 3 - (i % 3) * 2, l: Math.max(o, c) + 3 + (i % 2) * 3 };
    });
  }
  const all = buckets.flat();
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const y = (p: number) => 90 - ((p - lo) / (hi - lo)) * 80;
  return buckets.map((b) => ({ o: y(b[0]), c: y(b[b.length - 1]), h: y(Math.max(...b)), l: y(Math.min(...b)) }));
}

export function Boot() {
  const { prices, history } = useOneUp();
  // shown until we know this session hasn't seen it, so the app never flashes underneath first
  const [state, setState] = useState<"boot" | "leaving" | "gone">("boot");
  const [pressed, setPressed] = useState<"long" | "short" | "start" | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // the cards lean toward the pointer: its place on screen as --mx and --my, each from -1 to 1
  useEffect(() => {
    const el = root.current;
    if (!el || !window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty("--mx", ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        el.style.setProperty("--my", ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      });
    };
    el.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onMove);
    };
  }, []);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === "1" && !forced()) return setState("gone");
    } catch {}
    // a link straight to a tab (/market, /leaders…) opens that tab: the power-on screen belongs to the front door
    if ((automated() || location.pathname !== "/") && !forced()) return setState("gone");
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
  // the market with the most history so far, as candles; a made-up rise until there's enough of it
  const candles = toCandles(Object.values(history).sort((a, b) => b.length - a.length)[0] ?? []);
  const last = candles[candles.length - 1];
  const ticker = Object.entries(prices).map(([m, p]) => `${m.split("-")[0]} ${fmtPrice(p)}`);
  const tape = ticker.length ? ticker.join("   ·   ") : "NEAR   ·   BTC   ·   ETH";

  return (
    <div ref={root} className={`boot ${state === "leaving" ? "boot-leave" : ""}`} role="dialog" aria-modal="true" aria-label="OneUp. Press any key or tap to view the markets.">
      <div className="boot-stage">
        <div className="boot-nfts" aria-hidden>
          {CARDS.map((card, i) => (
            <SampleCard key={card.id} card={card} i={i} />
          ))}
        </div>
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
              <div className="boot-logo">
                <Logo size={64} />
                <span className="display boot-word">OneUp</span>
              </div>
              <svg className="boot-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                {[25, 50, 75].map((y) => (
                  <rect key={y} className="boot-grid" x={0} y={y} width={100} height={0.8} />
                ))}
                {candles.map((c, i) => {
                  const w = 100 / candles.length;
                  const up = c.c <= c.o;
                  const top = Math.min(c.o, c.c);
                  return (
                    <g key={i} className={`boot-candle ${up ? "up" : "down"}`} style={{ "--i": i } as React.CSSProperties}>
                      <rect x={i * w + w * 0.44} y={c.h} width={w * 0.12} height={c.l - c.h} />
                      <rect x={i * w + w * 0.18} y={top} width={w * 0.64} height={Math.max(2, Math.abs(c.c - c.o))} />
                    </g>
                  );
                })}
                {/* the price now, once the last candle is in */}
                <path className="boot-now" d={`M0 ${last.c} H100`} />
              </svg>
              <div className="boot-ticker display" aria-hidden>
                <span>
                  {tape}   ·   {tape}   ·   
                </span>
              </div>
            </div>
          </div>
          {/* the keys: leverage on the pad, LONG and SHORT where A and B would be */}
          <div className="boot-pad">
            {/* leverage on the pad, an amount on each arm */}
            <span className="boot-dpad" aria-hidden>
              <span className="boot-dpad-label">LEV</span>
              <span className="boot-lev up">1000×</span>
              <span className="boot-lev right">100×</span>
              <span className="boot-lev down">10×</span>
              <span className="boot-lev left">2×</span>
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
              ENTER
            </button>
          </div>
          <div className="boot-grille" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        </div>
      </div>
      <p className="boot-hint">Tap, click or press any key to view the markets</p>
    </div>
  );
}
