"use client";

// An Extra Life as a trading card: the NFT's own picture (drawn as the contract draws it), the trade or round it
// came from, a payout bar lit row by row like the heart, and paid against owed. The power-on screen deals sample
// cards around the console; the Extra Lives page shows the account's real ones.

import type { CSSProperties, ReactNode } from "react";
import { lifeImage, lifeRows, type LifeState } from "@/lib/lifeArt";

export type LifeCardTone = "long" | "short" | "backer" | "recovery";

export function LifeCard({
  id,
  paid,
  owed,
  state,
  backer = false,
  tone,
  tag,
  detail,
  amount,
  extra,
  className = "",
  style,
}: {
  id: string;
  paid: bigint;
  owed: bigint;
  state: LifeState;
  backer?: boolean;
  /** The chip: the trade's side, or what kind of Life it is. */
  tone: LifeCardTone;
  tag: string;
  /** Beside the chip: the market and leverage, the round, or the pool. */
  detail: string;
  /** Paid against owed, already formatted. */
  amount: string;
  /** Under the card's foot, such as USDC waiting to be claimed. */
  extra?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const lit = lifeRows(paid, owed);
  return (
    <div className={`life-card ${state} ${backer ? "backer" : ""} ${className}`} style={style}>
      <div className="life-card-top">
        <span className="display">EXTRA LIFE</span>
        <span className="num">#{id}</span>
      </div>
      <span className="life-card-stripes" />
      <div className="life-card-art">
        <img src={lifeImage(paid, owed, state, backer)} alt="" />
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
        <span>{state === "full_heal" ? "FULL HEAL" : state === "expired" ? "EXPIRED" : "PAID"}</span>
        <span className="num">{amount}</span>
      </div>
      {extra}
    </div>
  );
}

/** The contract's picture state for a Life: gold once paid in full, grey once expired. */
export const lifeState = (life: { full_heal: boolean; expired: boolean }): LifeState =>
  life.full_heal ? "full_heal" : life.expired ? "expired" : "earning";
