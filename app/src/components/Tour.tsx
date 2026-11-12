"use client";

// "See the whole loop": the walkthrough on the Trade page. It takes a newcomer through what OneUp is built around
// (trade, lose, get a Life NFT, claim or sell it, open its holder room) and ticks each step off from their own account.
// A phone gets one strip above the chart: where you are, the next step and its one action, with the full list behind
// a tap. A desktop has room for the whole checklist beside the order form.

import { useEffect, useRef, useState } from "react";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeHref } from "@/lib/recovery-journey";
import { SHOW_TOUR, claimedOrListedHere, currentStep, hideTour, holderOpened, tourHidden, tourSteps, watchStart, watchTrading, type TourStep } from "@/lib/tour";
import { useHistory } from "./History";
import { Icon } from "./Icon";
import { useListings } from "./Sell";
import { GuestButton } from "./ui";

/** The account's open positions and waiting orders, as the Trade page already reads them. */
interface Trading {
  positions: number;
  orders: number;
}

/** The Trade page has a place for the walkthrough on each kind of screen; only the one that fits the window
 *  renders, so there is one walkthrough and one set of reads. */
export function Tour({ slot, trading }: { slot: "phone" | "desktop"; trading: Trading }) {
  const [here, setHere] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const read = () => {
      setHere(wide.matches === (slot === "desktop"));
      setHidden(tourHidden());
      setReveal(0);
    };
    read();
    // asked for again from the footer (lib/tour.ts showTour): back, and into view
    const show = () => {
      setHidden(false);
      setReveal((n) => n + 1);
    };
    wide.addEventListener("change", read);
    window.addEventListener(SHOW_TOUR, show);
    return () => {
      wide.removeEventListener("change", read);
      window.removeEventListener(SHOW_TOUR, show);
    };
  }, [slot]);
  if (!here || hidden) return null;
  const hide = () => {
    hideTour();
    setHidden(true);
  };
  return <Steps compact={slot === "phone"} hide={hide} reveal={reveal} trading={trading} />;
}

function Steps({ compact, hide, reveal, trading }: { compact: boolean; hide: () => void; reveal: number; trading: Trading }) {
  const { d, o, me, viewOnly, wallet, guestsOn, guestBusy } = useOneUp();
  const ref = useRef<HTMLElement>(null);
  // asked for again while the page is open: scroll to it
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reveal]);
  // phones: the full list stays folded until asked for
  const [open, setOpen] = useState(false);
  const lives = usePoll(() => o.lives(me), [me], 5000) ?? [];
  const listings = useListings();
  const history = useHistory(me);
  // the history is published a minute or two behind the chain, so the trade steps also go by what this visit has
  // watched: an order or a position seen, then the position gone or a loss in the round (the read the loss banner uses)
  const roundLoss = BigInt(usePoll(() => o.pendingLife(me), [me]) ?? "0") > 0n;
  const [watched, setWatched] = useState(() => watchStart(me));
  useEffect(() => {
    setWatched((w) => watchTrading(w, me, { positions: trading.positions, orders: trading.orders, roundLoss }));
  }, [me, trading.positions, trading.orders, roundLoss]);
  const seen = watched.account === me ? watched : watchStart(me);

  const guests = d.network === "testnet" && guestsOn;
  const items = history?.items ?? [];
  const steps = tourSteps(
    {
      hasAccount: !viewOnly && !!me,
      traded: seen.traded || trading.positions > 0 || trading.orders > 0,
      tradeEnded: seen.ended || roundLoss || items.some((i) => i.kind === "trade"),
      lives: lives.length,
      claimedOrListed:
        (!!me && claimedOrListedHere(me)) ||
        items.some((i) => i.kind === "claim_usdc" || (i.kind === "sold" && i.what === "Life NFT")) ||
        listings.some((l) => l.seller === me && l.nft_contract === d.contracts.life),
      holderOpened: !!me && holderOpened(me),
    },
    Math.round(d.epochLengthS / 60),
    guests,
  );
  const now = currentStep(steps);
  const doneCount = steps.filter((s) => s.done).length;
  const firstLife = lives[0]?.token_id;
  const goTo = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: compact ? "start" : "center" });
  const action = (() => {
    switch (now?.id) {
      case "account": {
        // once a guest account is on its way, the other way in only gets in the way. Phones: the guest button alone
        // while the strip is folded, since the header's Connect is right above; the open list adds the wallet
        const walletToo = !guestBusy && (!compact || !guests || open);
        return (
          <div className={compact ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"}>
            <GuestButton className="btn btn-accent" />
            {walletToo && (
              <button type="button" className={`btn ${guests ? "btn-ghost" : "btn-accent"}`} disabled={wallet.busy} onClick={() => void wallet.connect()}>
                <Icon name="wallet" />
                Connect wallet
              </button>
            )}
          </div>
        );
      }
      case "trade":
        return (
          <button type="button" className={`btn btn-ghost ${compact ? "" : "self-start"}`} onClick={goTo("order-ticket")}>
            Go to the order form
          </button>
        );
      case "close":
        return (
          <button type="button" className={`btn btn-ghost ${compact ? "" : "self-start"}`} onClick={goTo("positions")}>
            Go to your position
          </button>
        );
      case "life":
        return (
          <a className={`btn btn-ghost ${compact ? "" : "self-start"}`} href="/life-nfts">
            Your Life NFTs
          </a>
        );
      case "claim":
      case "holder":
        return firstLife ? (
          <a className={`btn btn-ghost ${compact ? "" : "self-start"}`} href={lifeHref(firstLife)}>
            Open your Life
          </a>
        ) : null;
      default:
        return null;
    }
  })();

  const list = (
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
  );
  const done = "That's the loop: a loss became a Life NFT that you claimed or listed, and its holder room opened for you. The README explains what is real and what is mocked.";

  if (compact) {
    return (
      <section ref={ref} id="tour" className="panel flex scroll-mt-4 flex-col gap-2.5 p-3.5" aria-label="Walkthrough">
        <button type="button" className="-my-1 flex min-h-9 items-center justify-between gap-3 text-left" aria-expanded={open} aria-controls="tour-steps" onClick={() => setOpen(!open)}>
          {/* folded: the step you're on; open: the list below names it, so the strip names the walkthrough */}
          <span className="flex min-w-0 items-center gap-2 font-extrabold leading-tight">
            {!open && now && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--panel-2)] text-[11px]">{steps.indexOf(now) + 1}</span>}
            <span className="min-w-0">{open || !now ? "See the whole loop" : now.title}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[var(--muted)]">
            <Pips steps={steps} now={now} />
            <span className="sr-only">{now ? `Step ${steps.indexOf(now) + 1} of ${steps.length}. ${open ? "Hide" : "Show"} all steps` : `All ${steps.length} steps done`}</span>
            <Icon name="chevron" size={16} className={open ? "rotate-180" : undefined} />
          </span>
        </button>
        <div id="tour-steps" className="flex flex-col gap-2.5">
          {open && list}
          <p className="text-sm text-[var(--muted)]">{now ? (open ? now.hint : now.short) : done}</p>
        </div>
        {action}
        {(open || !now) && (
          <button type="button" className="chip self-start" onClick={hide}>
            Hide the walkthrough
          </button>
        )}
      </section>
    );
  }

  return (
    <section ref={ref} id="tour" className="panel flex scroll-mt-4 flex-col gap-3 p-4" aria-label="Walkthrough">
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
      {list}
      {now ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] p-3">
          <p className="text-sm">{now.hint}</p>
          {action}
        </div>
      ) : (
        <p className="text-sm">{done}</p>
      )}
    </section>
  );
}

/** Six squares: done, the one you're on, and the ones to come. */
function Pips({ steps, now }: { steps: TourStep[]; now: TourStep | null }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {steps.map((s) => (
        <span key={s.id} className="h-[7px] w-[7px] rounded-[2px]" style={{ background: s.done ? "var(--long)" : s === now ? "var(--text)" : "var(--panel-2)" }} />
      ))}
    </span>
  );
}
