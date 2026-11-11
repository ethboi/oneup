// The walkthrough on the Trade page (components/Tour.tsx): the loop OneUp is built around, as steps that tick
// themselves off from the account's own state.

export interface TourState {
  hasAccount: boolean;
  /** Has an order waiting or a position open, or has had one. */
  traded: boolean;
  /** Has had a trade closed or liquidated. */
  tradeEnded: boolean;
  lives: number;
  /** Claimed USDC from a Life, or listed or sold one. */
  claimedOrListed: boolean;
  /** Opened a Life's holder room in this browser. */
  holderOpened: boolean;
}

/** What one visit has watched an account's trading do. The published history runs a minute or two behind the chain,
 *  and at high leverage a trade can open and be liquidated inside that gap, so the walkthrough also goes by what it
 *  saw happen: the steps tick when the trade does, not when the history catches up. */
export interface TourWatch {
  account: string;
  /** Positions open at the last look. */
  positions: number;
  /** An order or a position has been seen. */
  traded: boolean;
  /** A position has gone, or the round shows a loss for the account. */
  ended: boolean;
}
export const watchStart = (account: string): TourWatch => ({ account, positions: 0, traded: false, ended: false });
/** The watch after one more look. `roundLoss`: the account has a net loss in the open round, which only a closed or
 *  liquidated trade leaves. Returns `prev` itself when nothing changed. */
export function watchTrading(prev: TourWatch, account: string, now: { positions: number; orders: number; roundLoss: boolean }): TourWatch {
  const w = prev.account === account ? prev : watchStart(account);
  const ended = w.ended || now.roundLoss || now.positions < w.positions;
  const traded = w.traded || ended || now.positions > 0 || now.orders > 0;
  if (w === prev && traded === w.traded && ended === w.ended && now.positions === w.positions) return prev;
  return { account, positions: now.positions, traded, ended };
}

export type TourStepId = "account" | "trade" | "close" | "life" | "claim" | "holder";

export interface TourStep {
  id: TourStepId;
  title: string;
  hint: string;
  /** One line, for the strip a phone shows. */
  short: string;
  done: boolean;
}

/** `guests`: whether the site is handing out guest accounts, so the first step can offer one. */
export function tourSteps(s: TourState, roundMinutes: number, guests = true): TourStep[] {
  const rounds = roundMinutes >= 1 ? `every ${roundMinutes} minute${roundMinutes === 1 ? "" : "s"}` : "on a short timer";
  return [
    {
      id: "account",
      title: "Get an account",
      done: s.hasAccount,
      hint: guests ? "Try it as a guest (no wallet, 1,000 test USDC), or connect a NEAR testnet wallet." : "Connect a NEAR testnet wallet. Everything here is test money.",
      short: guests ? "No wallet needed: a guest account comes with 1,000 test USDC." : "Connect a NEAR testnet wallet. It's all test money.",
    },
    {
      id: "trade",
      title: "Open a trade",
      done: s.traded || s.tradeEnded,
      // $50 is the form's smallest preset: enough to see a liquidation, with most of a guest's 1,000 left
      hint: "Pick Long or Short, tap $50 of margin and a high leverage, then press the big button. A keeper fills it at the next price.",
      short: "Pick Long or Short, $50 of margin, high leverage, then send it.",
    },
    {
      id: "close",
      title: "Lose it, or win it",
      done: s.tradeEnded,
      hint: "At high leverage a small move liquidates the trade. You can also close it yourself after 60 seconds.",
      short: "A small move liquidates it. You can close it yourself after 60 seconds.",
    },
    {
      id: "life",
      title: "Get a Life NFT",
      done: s.lives > 0,
      hint: `Rounds close ${rounds} (the countdown is in the header). If the house ended the round in profit, each wallet with a net loss gets a Life NFT. If it didn't, trade again this round.`,
      short: `Rounds close ${rounds}. A net loss earns a Life NFT if the house profits.`,
    },
    {
      id: "claim",
      title: "Claim it, or list it",
      done: s.claimedOrListed,
      hint: "Open your Life to claim the USDC it has collected, or list it on the Market: a buyer gets its unclaimed USDC and its later payouts.",
      short: "Claim the USDC your Life has collected, or list it on the Market.",
    },
    {
      id: "holder",
      title: "Open its holder room",
      done: s.holderOpened,
      hint: "On your Life's page, open the room only its current holder can open. Your key signs a message; nothing is sent on chain.",
      short: "On your Life's page, open the room only its holder can open.",
    },
  ];
}

/** The first step not done yet, or null when the loop is complete. */
export const currentStep = (steps: TourStep[]): TourStep | null => steps.find((s) => !s.done) ?? null;

/** Fired when a hidden walkthrough is asked for again (showTour). */
export const SHOW_TOUR = "oneup-show-tour";

const TOUR_HIDDEN = "oneup.tour.hidden";
export function tourHidden(): boolean {
  try {
    return localStorage.getItem(TOUR_HIDDEN) === "1";
  } catch {
    return false;
  }
}
export function hideTour() {
  try {
    localStorage.setItem(TOUR_HIDDEN, "1");
  } catch {}
}
/** Brings a hidden walkthrough back: the Trade page shows it when it next opens, and scrolls to it if it's open now. */
export function showTour() {
  try {
    localStorage.removeItem(TOUR_HIDDEN);
  } catch {}
  window.dispatchEvent(new Event(SHOW_TOUR));
}

const HOLDER_FLAG = "oneup.tour.holder";
export function markHolderOpened(account: string) {
  try {
    localStorage.setItem(`${HOLDER_FLAG}:${account}`, "1");
  } catch {}
}
export function holderOpened(account: string): boolean {
  try {
    return localStorage.getItem(`${HOLDER_FLAG}:${account}`) === "1";
  } catch {
    return false;
  }
}
