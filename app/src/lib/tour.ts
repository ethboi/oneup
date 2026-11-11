// The walkthrough on the Trade page (components/Tour.tsx): the loop OneUp is built around, as steps that tick
// themselves off from the account's own state.

export interface TourState {
  hasAccount: boolean;
  openPositions: number;
  /** Trades this account has closed or had liquidated. */
  tradesClosed: number;
  lives: number;
  /** Claimed USDC from a Life, or listed or sold one. */
  claimedOrListed: boolean;
  /** Opened a Life's holder room in this browser. */
  holderOpened: boolean;
}

export type TourStepId = "account" | "trade" | "close" | "life" | "claim" | "holder";

export interface TourStep {
  id: TourStepId;
  title: string;
  hint: string;
  done: boolean;
}

export function tourSteps(s: TourState, roundMinutes: number): TourStep[] {
  const rounds = roundMinutes >= 1 ? `every ${roundMinutes} minute${roundMinutes === 1 ? "" : "s"}` : "on a short timer";
  return [
    { id: "account", title: "Get an account", done: s.hasAccount, hint: "Try it as a guest (no wallet, 1,000 test USDC), or connect a NEAR testnet wallet." },
    { id: "trade", title: "Open a trade", done: s.openPositions > 0 || s.tradesClosed > 0, hint: "Pick Long or Short, set $10 of margin and a high leverage, then press the big button. A keeper fills it at the next price." },
    { id: "close", title: "Lose it, or win it", done: s.tradesClosed > 0, hint: "At high leverage a small move liquidates the trade. You can also close it yourself after 60 seconds." },
    {
      id: "life",
      title: "Get a Life NFT",
      done: s.lives > 0,
      hint: `Rounds close ${rounds} (the countdown is in the header). If the house ended the round in profit, each wallet with a net loss gets a Life NFT. If it didn't, trade again this round.`,
    },
    { id: "claim", title: "Claim it, or list it", done: s.claimedOrListed, hint: "Open your Life to claim the USDC it has collected, or list it on the Market: a buyer gets its unclaimed USDC and its later payouts." },
    { id: "holder", title: "Open its holder room", done: s.holderOpened, hint: "On your Life's page, open the room only its current holder can open. Your key signs a message; nothing is sent on chain." },
  ];
}

/** The first step not done yet, or null when the loop is complete. */
export const currentStep = (steps: TourStep[]): TourStep | null => steps.find((s) => !s.done) ?? null;

/** Fired by the More menu's "Show the walkthrough". */
export const SHOW_TOUR = "oneup-show-tour";

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
