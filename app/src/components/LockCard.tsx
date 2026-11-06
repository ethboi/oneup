"use client";

// A $1UP lock as a trading card, in the same frame as a Life NFT (LifeCard): its padlock, where it came from, a
// bar of the time left, and the amount locked.

import type { PointerEvent, ReactNode } from "react";
import { lockImage, partsLeft, type LockState } from "@/lib/lockArt";

export type LockCardTone = "locked" | "recovery" | "merged";

export function LockCard({
  id,
  left,
  of,
  state,
  tone,
  tag,
  detail,
  foot,
  amount,
  extra,
}: {
  id: string;
  /** Rounds until it can be unlocked, out of the longest a lock can run. */
  left: number;
  of: number;
  state: LockState;
  tone: LockCardTone;
  /** The chip: how this lock came about. */
  tag: string;
  detail: string;
  foot: string;
  amount: string;
  extra?: ReactNode;
}) {
  const lit = state === "locked" ? partsLeft(left, of, 8) : state === "ready" ? 8 : 0;
  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    const r = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", (((event.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    event.currentTarget.style.setProperty("--my", (((event.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const untilt = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.removeProperty("--mx");
    event.currentTarget.style.removeProperty("--my");
  };
  return (
    <div onPointerMove={tilt} onPointerLeave={untilt}>
      <div className={`life-card lock ${state}`}>
        <div className="life-card-top">
          <span className="display">$1UP LOCK</span>
          <span className="num">#{id}</span>
        </div>
        <span className="life-card-stripes" />
        <div className="life-card-art">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lockImage(left, of, state)} alt="" />
        </div>
        <div className="life-card-trade">
          <span className={`life-card-side ${tone}`}>{tag}</span>
          <span className="truncate">{detail}</span>
        </div>
        <div className="life-card-bar">
          {Array.from({ length: 8 }, (_, k) => (
            <i key={k} className={k < lit ? "on" : ""} />
          ))}
        </div>
        <div className="life-card-foot">
          <span>{foot}</span>
          <span className="num">{amount}</span>
        </div>
        {extra}
      </div>
    </div>
  );
}
