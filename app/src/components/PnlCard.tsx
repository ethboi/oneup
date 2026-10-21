"use client";

// Shareable PnL cards: the console's look (case, slate bezel, stripes, LCD) drawn on a 1200×675 canvas, the
// size X and most chats preview well. A win shows the return; a loss shows the Extra Life it brings. The
// dialog offers download, copy, the phone's share sheet and a post on X.

import { useEffect, useRef, useState } from "react";
import { fmtUsdc } from "@oneup/sdk";
import { fmtPrice } from "./Trade";
import { Icon } from "./Icon";

export interface CardData {
  market: string;
  side: "Long" | "Short";
  leverage: number;
  /** USDC, 6 decimals. */
  margin: bigint;
  /** Signed USDC, 6 decimals. */
  pnl: bigint;
  /** 1e8 units. */
  entry: bigint;
  /** Exit price, or the mark for an open position. */
  exit: bigint;
  state: "open" | "closed" | "liquidated";
  account: string;
  /** A Full Heal card instead of a trade: the life's epoch and what it paid back. */
  heal?: { epoch: number; paid: bigint };
}

const W = 1200;
const H = 675;
const C = {
  case: "#e9ebf1",
  caseEdge: "#c9ccd8",
  bezel: "#4a4d63",
  stripe1: "#a3195b",
  stripe2: "#2f3c94",
  lcd: "#b7c49a",
  lcdGrid: "rgba(30,42,22,0.07)",
  ink: "#1e2a16",
  inkSoft: "#4f5d3b",
  heart: "#e2257a",
  coin: "#f2b705",
  edge: "#1c1b29",
  wordmark: "#2f3c94",
  muted: "#5d6070",
};

const HEART = [".##...##.", "#*#######", "#########", "#########", ".#######.", "..#####..", "...###...", "....#...."];
const COIN = ["..####..", ".######.", "###||###", "###||###", "###||###", "###||###", ".######.", "..####.."];

const roe = (d: CardData) => (d.margin > 0n ? (Number(d.pnl) / Number(d.margin)) * 100 : 0);
const signed = (x: bigint) => `${x >= 0n ? "+" : "−"}$${fmtUsdc(x < 0n ? -x : x)}`;

/** Fonts as next/font named them (hashed family names), read off the page. */
function fonts() {
  const s = getComputedStyle(document.documentElement);
  return { pixel: s.getPropertyValue("--font-pixel").trim() || "monospace", body: s.getPropertyValue("--font-rounded").trim() || "sans-serif" };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: [number, number, number, number]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function sprite(ctx: CanvasRenderingContext2D, rows: string[], colors: Record<string, string>, x: number, y: number, cell: number) {
  const on = (cx: number, cy: number) => cy >= 0 && cy < rows.length && cx >= 0 && cx < rows[0].length && rows[cy][cx] !== ".";
  ctx.fillStyle = C.edge;
  for (let cy = -1; cy <= rows.length; cy++)
    for (let cx = -1; cx <= rows[0].length; cx++)
      if (!on(cx, cy) && (on(cx - 1, cy) || on(cx + 1, cy) || on(cx, cy - 1) || on(cx, cy + 1))) ctx.fillRect(x + (cx + 1) * cell, y + (cy + 1) * cell, cell + 0.5, cell + 0.5);
  for (let cy = 0; cy < rows.length; cy++)
    for (let cx = 0; cx < rows[0].length; cx++) {
      const ch = rows[cy][cx];
      if (ch === ".") continue;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(x + (cx + 1) * cell, y + (cy + 1) * cell, cell + 0.5, cell + 0.5);
    }
}

export async function drawCard(canvas: HTMLCanvasElement, d: CardData) {
  const f = fonts();
  // best effort: a fallback face that can't load (next/font's local Arial on Linux) rejects the whole load
  await Promise.allSettled([`700 40px ${f.pixel}`, `800 40px ${f.body}`, `500 40px ${f.body}`].map((x) => document.fonts.load(x)));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const win = d.pnl >= 0n;

  // the case
  ctx.fillStyle = C.case;
  ctx.fillRect(0, 0, W, H);

  // brand row
  sprite(ctx, HEART, { "#": C.heart, "*": "#fff" }, 56, 34, 5);
  ctx.fillStyle = C.coin;
  roundRect(ctx, 92, 26, 34, 22, [6, 6, 6, 6]);
  ctx.fill();
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = C.edge;
  ctx.font = `700 15px ${f.pixel}`;
  ctx.textAlign = "center";
  ctx.fillText("+1", 109, 43);
  ctx.textAlign = "left";
  ctx.font = `700 40px ${f.pixel}`;
  ctx.fillText("OneUp", 128, 76);
  ctx.textAlign = "right";
  ctx.fillStyle = C.muted;
  ctx.font = `500 24px ${f.body}`;
  ctx.fillText(d.account.replace(/\.test\.near$/, ""), W - 56, 68);
  ctx.textAlign = "left";

  // the slate bezel, big corner bottom right like the case
  const bx = 48, by = 108, bw = W - 96, bh = 470;
  ctx.fillStyle = C.bezel;
  roundRect(ctx, bx, by, bw, bh, [18, 18, 90, 18]);
  ctx.fill();
  ctx.fillStyle = C.stripe1;
  ctx.fillRect(bx + 30, by + 22, bw - 60, 3);
  ctx.fillStyle = C.stripe2;
  ctx.fillRect(bx + 30, by + 30, bw - 60, 3);

  // the LCD
  const lx = bx + 30, ly = by + 52, lw = bw - 60, lh = bh - 92;
  ctx.fillStyle = C.lcd;
  roundRect(ctx, lx, ly, lw, lh, [10, 10, 10, 10]);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = C.lcdGrid;
  for (let x = lx; x < lx + lw; x += 4) ctx.fillRect(x, ly, 1, lh);
  for (let y = ly; y < ly + lh; y += 4) ctx.fillRect(lx, y, lw, 1);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(lx, ly, lw, 4);
  ctx.restore();

  const px = lx + 40;
  if (d.heal) {
    drawHeal(ctx, f, d.heal, { lx, ly, lw, lh, px });
    footer(ctx, f, bx);
    return;
  }
  ctx.fillStyle = C.ink;
  ctx.font = `700 34px ${f.pixel}`;
  ctx.fillText(d.market, px, ly + 64);
  const tag = `${d.side.toUpperCase()} ${d.leverage}×`;
  const mw = ctx.measureText(d.market).width;
  ctx.font = `800 24px ${f.body}`;
  const tw = ctx.measureText(tag).width + 28;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2.5;
  roundRect(ctx, px + mw + 20, ly + 34, tw, 40, [8, 8, 8, 8]);
  ctx.stroke();
  ctx.fillText(tag, px + mw + 34, ly + 63);
  if (d.state !== "closed") {
    ctx.fillStyle = C.inkSoft;
    ctx.font = `700 22px ${f.pixel}`;
    ctx.fillText(d.state === "open" ? "OPEN" : "LIQUIDATED", px + mw + tw + 40, ly + 62);
    ctx.fillStyle = C.ink;
  }

  // the number
  const r = roe(d);
  ctx.font = `800 148px ${f.body}`;
  ctx.fillText(`${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}%`, px - 6, ly + 222);
  ctx.font = `800 40px ${f.body}`;
  ctx.fillText(signed(d.pnl), px, ly + 280);

  ctx.font = `500 24px ${f.body}`;
  ctx.fillStyle = C.inkSoft;
  const ex = d.state === "open" ? "Mark" : "Exit";
  ctx.fillText(`Entry ${fmtPrice(d.entry)}     ${ex} ${fmtPrice(d.exit)}     Margin $${fmtUsdc(d.margin, 0)}`, px, ly + 340);

  // the right side: a coin for a win, the heart and its promise for a loss
  const cx = lx + lw - 200; // centre of the right-hand art
  if (win) {
    sprite(ctx, COIN, { "#": C.coin, "|": "#b58a00" }, cx - 85, ly + 70, 17);
  } else {
    sprite(ctx, HEART, { "#": C.heart, "*": "#fff" }, cx - 94, ly + 40, 17);
    ctx.fillStyle = C.ink;
    ctx.textAlign = "center";
    ctx.font = `700 30px ${f.pixel}`;
    ctx.fillText("+1 EXTRA LIFE", cx, ly + 270);
    ctx.font = `500 21px ${f.body}`;
    ctx.fillStyle = C.inkSoft;
    ctx.fillText("paid back from the house's profit", cx, ly + 302);
    ctx.textAlign = "left";
  }

  footer(ctx, f, bx);
}

/** Below the screen: the tagline. */
function footer(ctx: CanvasRenderingContext2D, f: { pixel: string }, bx: number) {
  ctx.fillStyle = C.wordmark;
  ctx.font = `700 28px ${f.pixel}`;
  ctx.textAlign = "left";
  ctx.fillText("Lose a trade, get a life.", bx + 6, H - 36);
}

/** The Full Heal card: the life paid back in full. */
function drawHeal(
  ctx: CanvasRenderingContext2D,
  f: { pixel: string; body: string },
  heal: { epoch: number; paid: bigint },
  { lx, ly, lw, px }: { lx: number; ly: number; lw: number; lh: number; px: number },
) {
  ctx.fillStyle = C.ink;
  ctx.textAlign = "left";
  ctx.font = `700 34px ${f.pixel}`;
  ctx.fillText(`EXTRA LIFE · EPOCH ${heal.epoch}`, px, ly + 64);
  ctx.font = `700 96px ${f.pixel}`;
  ctx.fillText("FULL HEAL", px - 4, ly + 180);
  ctx.font = `800 54px ${f.body}`;
  ctx.fillText(`+$${fmtUsdc(heal.paid)} back`, px, ly + 258);
  ctx.font = `500 24px ${f.body}`;
  ctx.fillStyle = C.inkSoft;
  ctx.fillText("A losing trade, paid back in full from the house's profit.", px, ly + 318);
  sprite(ctx, HEART, { "#": C.heart, "*": "#fff" }, lx + lw - 290, ly + 40, 21);
}

export function shareText(d: CardData) {
  if (d.heal) return `Full Heal: a losing trade paid me back $${fmtUsdc(d.heal.paid, 0)} on OneUp. Lose a trade, get a life.`;
  const r = roe(d);
  return d.pnl >= 0n
    ? `+${r.toFixed(1)}% on ${d.market} ${d.side.toLowerCase()} ${d.leverage}× on OneUp.`
    : `Lost $${fmtUsdc(-d.pnl, 0)} on ${d.market} and got an Extra Life for it. OneUp: lose a trade, get a life.`;
}

/** A Share button that opens the card dialog. */
export function ShareButton({ data, compact }: { data: () => CardData; compact?: boolean }) {
  const [open, setOpen] = useState<CardData | null>(null);
  return (
    <>
      <button className={`btn btn-ghost ${compact ? "px-2.5 py-1" : ""}`} onClick={() => setOpen(data())} aria-label="Share PnL card" title="Share PnL card">
        <Icon name="share" />
        {!compact && "Share"}
      </button>
      {open && <ShareDialog data={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function ShareDialog({ data, onClose }: { data: CardData; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    drawCard(ref.current!, data).then(() => ref.current!.toBlob((b) => live && setBlob(b), "image/png"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      live = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [data, onClose]);

  const name = data.heal ? `oneup-full-heal-${data.heal.epoch}.png` : `oneup-${data.market.toLowerCase()}-${data.side.toLowerCase()}.png`;
  const file = blob ? new File([blob], name, { type: "image/png" }) : null;
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const download = () => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob! })]);
      setNote("Image copied");
    } catch {
      setNote("This browser can't copy images: use Download");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Share PnL card" className="panel flex w-full max-w-[720px] flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-extrabold">Share</h2>
          <button className="btn btn-ghost px-2.5" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <canvas ref={ref} className="h-auto w-full rounded-lg border border-[var(--line)]" aria-label={shareText(data)} />
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-accent" disabled={!blob} onClick={download}>
            <Icon name="deposit" />
            Download
          </button>
          <button className="btn btn-ghost" disabled={!blob} onClick={copy}>
            Copy image
          </button>
          {canShare && (
            <button className="btn btn-ghost" onClick={() => navigator.share({ files: [file!], text: shareText(data) }).catch(() => {})}>
              <Icon name="share" />
              Share…
            </button>
          )}
          <a
            className="btn btn-ghost"
            href={`https://x.com/intent/post?text=${encodeURIComponent(shareText(data))}`}
            target="_blank"
            rel="noreferrer"
            title="Opens X with the text; attach the downloaded image"
          >
            Post on X
          </a>
        </div>
        {note && <p className="label">{note}</p>}
      </div>
    </div>
  );
}
