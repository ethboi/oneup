"use client";

import { useEffect, useState } from "react";
import { fmtUsdc } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { lifeHref, recoveryStep } from "@/lib/recovery-journey";
import { Icon } from "./Icon";
import { PixelHeart } from "./Pixel";

const KEY = "oneup.onboarded";

/** A persistent guide that reflects this wallet, including finished NFTs with unclaimed funds. */
export function Onboarding() {
  const { o, me } = useOneUp();
  const lives = usePoll(() => o.lives(me), [me]);
  const pending = usePoll(() => o.pendingLife(me), [me]);
  const expiry = usePoll(() => o.params(), [], 60_000)?.life_expiry_epochs;
  const next = recoveryStep(lives, pending);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    // open once on a first visit, except on phones, where the steps would stand between you and the screen
    const roomy = window.matchMedia("(min-width: 1024px)").matches;
    try { setExpanded(roomy && localStorage.getItem(KEY) !== "1"); } catch { setExpanded(roomy); }
  }, []);
  const status = next.phase === "loading" ? "Checking your Lives…"
    : next.phase === "claim" ? `$${fmtUsdc(next.claimable)} available to claim from ${next.count} ${next.count === 1 ? "Life" : "Lives"}`
    : next.phase === "earning" ? `${next.count} ${next.count === 1 ? "Life can" : "Lives can"} still receive payouts. Future payouts may be zero.`
    : next.phase === "pending" ? `$${fmtUsdc(BigInt(pending!))} net loss this round. Eligibility for an Extra Life is confirmed when the round settles.`
    : next.phase === "finished" ? "Your Lives have reached their payout limits or ended their earning periods. No USDC remains to claim."
    : "You do not have an Extra Life or an unsettled net loss yet.";
  const action = next.phase === "claim" ? "View USDC to claim" : next.phase === "earning" ? "View your latest Life" : next.phase === "pending" ? "View this round" : next.phase === "finished" ? "View your finished Lives" : "Explore Extra Lives";
  const steps = [
    { icon: <Icon name="chart" size={20} />, title: "Trade", line: "OneUp takes 10–25% of winning trade profits. There are no entry or funding fees. Losses can be permanent.", href: "/about", action: "Read the rules" },
    { icon: <PixelHeart size={20} />, title: "Receive an Extra Life", line: `An eligible net loss in a profitable round can earn you an Extra Life.${expiry === undefined ? " The contract sets its earning period." : ` It is eligible for payouts in the round it is created and up to ${expiry} more rounds.`}`, href: "/extra-lives", action: lives ? `Your Lives (${lives.length})` : "Find your Lives" },
    { icon: <Icon name="claim" size={20} />, title: "Claim USDC", line: "USDC already allocated to your Life is available to claim. Its remaining payout limit is a maximum, not a forecast. Future payouts depend on house profit and may be zero.", href: next.phase === "claim" && next.tokenId ? lifeHref(next.tokenId) : "/extra-lives", action: next.claimable > 0n ? `$${fmtUsdc(next.claimable)} available to claim` : "Check available USDC" },
    { icon: <Icon name="store" size={20} />, title: "List your Life for sale", line: "Set your asking price. If someone buys your Life, its unclaimed USDC and remaining payout rights transfer to them. Listing it does not guarantee a sale.", href: next.tokenId ? lifeHref(next.tokenId) : "/market", action: next.tokenId ? "View your Life" : "Explore the market" },
  ];
  return (
    <details className="panel p-4" open={expanded} onToggle={event => { const open = event.currentTarget.open; setExpanded(open); try { localStorage.setItem(KEY, open ? "0" : "1"); } catch {} }}>
      <summary className="cursor-pointer text-sm font-bold marker:text-[var(--primary)]">
        How recovery works{" "}
        <span className="mt-1 block font-normal text-[var(--muted)] sm:ml-3 sm:mt-0 sm:inline">{status}</span>
      </summary>
      <div className="mt-4 flex flex-col justify-between gap-3 rounded-lg bg-[var(--panel-2)] p-3 text-sm sm:flex-row sm:items-center">
        <div><div className="label break-all">Selected wallet: {me}</div><p className="mt-1 font-semibold">{status}</p></div>
        {next.phase !== "loading" && <a className="btn btn-accent shrink-0 text-center" href={next.tokenId ? lifeHref(next.tokenId) : "/extra-lives"}>{action}</a>}
      </div>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, i) => <li key={step.title} className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--panel-2)] text-[var(--primary)]">{step.icon}</span><div className="text-sm"><b className="block">{i + 1}. {step.title}</b><p className="mt-1 text-[var(--muted)]">{step.line}</p><a className="mt-2 inline-block font-semibold text-[var(--primary)] underline underline-offset-2" href={step.href}>{step.action}</a></div></li>)}
      </ol>
    </details>
  );
}
