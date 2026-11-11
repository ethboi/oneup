"use client";

// "See the whole loop": a checklist on the Trade page that walks a newcomer through what OneUp is built around (trade,
// lose, get a Life NFT, claim or sell it, open its holder room) and ticks each step off from their own account.

import { useEffect, useState } from "react";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeHref } from "@/lib/recovery-journey";
import { SHOW_TOUR, currentStep, holderOpened, tourSteps } from "@/lib/tour";
import { useHistory } from "./History";
import { Icon } from "./Icon";
import { useListings } from "./Sell";
import { GuestButton } from "./ui";

const HIDDEN = "oneup.tour.hidden";

export function Tour() {
  const { d, o, me, viewOnly, wallet } = useOneUp();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(HIDDEN) === "1");
    } catch {
      setHidden(false);
    }
    const show = () => {
      try {
        localStorage.removeItem(HIDDEN);
      } catch {}
      setHidden(false);
      document.getElementById("tour")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(SHOW_TOUR, show);
    return () => window.removeEventListener(SHOW_TOUR, show);
  }, []);
  const positions = usePoll(() => o.positions(me), [me], 5000) ?? [];
  const lives = usePoll(() => o.lives(me), [me], 5000) ?? [];
  const listings = useListings();
  const history = useHistory(me);
  if (hidden) return null;

  const items = history?.items ?? [];
  const steps = tourSteps(
    {
      hasAccount: !viewOnly && !!me,
      openPositions: positions.length,
      tradesClosed: items.filter((i) => i.kind === "trade").length,
      lives: lives.length,
      claimedOrListed: items.some((i) => i.kind === "claim_usdc" || (i.kind === "sold" && i.what === "Life NFT")) || listings.some((l) => l.seller === me && l.nft_contract === d.contracts.life),
      holderOpened: !!me && holderOpened(me),
    },
    Math.round(d.epochLengthS / 60),
  );
  const now = currentStep(steps);
  const doneCount = steps.filter((s) => s.done).length;
  const firstLife = lives[0]?.token_id;
  const hide = () => {
    try {
      localStorage.setItem(HIDDEN, "1");
    } catch {}
    setHidden(true);
  };

  const action = (() => {
    switch (now?.id) {
      case "account":
        return (
          <div className="flex flex-wrap gap-2">
            <GuestButton className="btn btn-accent" />
            <button type="button" className="btn btn-ghost" disabled={wallet.busy} onClick={() => void wallet.connect()}>
              <Icon name="wallet" />
              Connect wallet
            </button>
          </div>
        );
      case "trade":
      case "close":
        return (
          <button type="button" className="btn btn-ghost" onClick={() => document.getElementById("order-form")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
            Go to the order form
          </button>
        );
      case "life":
        return (
          <a className="btn btn-ghost" href="/life-nfts">
            Your Life NFTs
          </a>
        );
      case "claim":
      case "holder":
        return firstLife ? (
          <a className="btn btn-ghost" href={lifeHref(firstLife)}>
            Open your Life
          </a>
        ) : null;
      default:
        return null;
    }
  })();

  return (
    <section id="tour" className="panel flex flex-col gap-3 p-4" aria-label="Walkthrough">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-extrabold">See the whole loop</h3>
        <span className="flex items-center gap-2">
          <span className="label num">
            {doneCount}/{steps.length}
          </span>
          <button type="button" className="chip" onClick={hide}>
            Hide
          </button>
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ background: s.done ? "var(--long)" : "var(--panel-2)", color: s.done ? "var(--bg)" : s === now ? "var(--text)" : "var(--muted)" }}
            >
              {s.done ? <Icon name="check" size={12} /> : i + 1}
            </span>
            <span className={s.done ? "text-[var(--muted)] line-through" : s === now ? "font-bold" : "text-[var(--muted)]"}>{s.title}</span>
          </li>
        ))}
      </ol>
      {now ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] p-3">
          <p className="text-sm">{now.hint}</p>
          {action}
        </div>
      ) : (
        <p className="text-sm">That&apos;s the loop: a loss became a Life NFT that you claimed or listed, and its holder room opened for you. The README explains what is real and what is mocked.</p>
      )}
    </section>
  );
}
