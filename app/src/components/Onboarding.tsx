"use client";

// The core loop stays discoverable after a trade or dismissal. Native details keeps it
// compact for returning traders, with ordinary links to each relevant screen.
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { PixelHeart } from "./Pixel";

const KEY = "oneup.onboarded";

export function Onboarding() {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(KEY) !== "1");
    } catch {
      setExpanded(true);
    }
  }, []);
  const steps = [
    { icon: <Icon name="chart" size={20} />, title: "Trade", line: "Winners pay a 10–25% cut; no entry or funding fee. A loss can still be permanent.", href: "/about", action: "Read the rules" },
    { icon: <PixelHeart size={20} />, title: "Receive a recovery NFT", line: "Eligible net losses in profitable rounds create Extra Lives. Each has a payout cap and earns in its mint round plus 13 more rounds.", href: "/extra-lives", action: "Find your Lives" },
    { icon: <Icon name="claim" size={20} />, title: "Claim earned USDC", line: "Future house profit can fund your Life. Claim what has accrued; the maximum payout is not a forecast. Recovery can be zero.", href: "/extra-lives", action: "Check claimable USDC" },
    { icon: <Icon name="store" size={20} />, title: "Transfer ownership", line: "List your Life for sale. A buyer inherits its remaining rights and unclaimed USDC. An exit requires a buyer.", href: "/market", action: "Explore the market" },
  ];
  return (
    <details
      className="panel mb-4 p-4"
      open={expanded}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded(open);
        try { localStorage.setItem(KEY, open ? "0" : "1"); } catch {}
      }}
    >
      <summary className="cursor-pointer text-sm font-bold marker:text-[var(--primary)]">
        How recovery works
        <span className="mt-1 block font-normal text-[var(--muted)] sm:ml-3 sm:mt-0 sm:inline">
          Loss → recovery NFT → USDC claim → transferable ownership
        </span>
      </summary>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--panel-2)] text-[var(--primary)]">{step.icon}</span>
            <div className="text-sm">
              <b className="block">{i + 1}. {step.title}</b>
              <p className="mt-1 text-[var(--muted)]">{step.line}</p>
              <a className="mt-2 inline-block font-semibold text-[var(--primary)] underline underline-offset-2" href={step.href}>{step.action}</a>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
