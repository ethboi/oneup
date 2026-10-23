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
    try { setExpanded(localStorage.getItem(KEY) !== "1"); } catch { setExpanded(true); }
  }, []);
  const status = next.phase === "loading" ? "Checking your recovery state…"
    : next.phase === "claim" ? `$${fmtUsdc(next.claimable)} ready to claim from ${next.count} ${next.count === 1 ? "Life" : "Lives"}`
    : next.phase === "earning" ? `${next.count} ${next.count === 1 ? "Life has" : "Lives have"} remaining earning rights; future payouts may be zero`
    : next.phase === "pending" ? `$${fmtUsdc(BigInt(pending!))} net loss this round; NFT eligibility is decided at settlement`
    : next.phase === "finished" ? "Your Lives have finished; no USDC remains unclaimed"
    : "No recovery NFT or unsettled loss in this wallet yet";
  const action = next.phase === "claim" ? "Review and claim your Life" : next.phase === "earning" ? "Inspect your latest Life" : next.phase === "pending" ? "Follow round settlement" : next.phase === "finished" ? "Review your finished Lives" : "Explore Extra Lives";
  const steps = [
    { icon: <Icon name="chart" size={20} />, title: "Trade", line: "Winners pay a 10–25% cut; no entry or funding fee. A loss can still be permanent.", href: "/about", action: "Read the rules" },
    { icon: <PixelHeart size={20} />, title: "Receive a recovery NFT", line: `Eligible net losses in profitable rounds create Extra Lives.${expiry === undefined ? " Their earning window follows the contract's expiry settings." : ` Each earns in its mint round plus up to ${expiry} more rounds.`}`, href: "/extra-lives", action: lives ? `Your Lives (${lives.length})` : "Find your Lives" },
    { icon: <Icon name="claim" size={20} />, title: "Claim earned USDC", line: "Claim USDC already allocated to your NFT. Its additional cap depends on future house profit and can pay zero; it is not a forecast.", href: next.phase === "claim" && next.tokenId ? lifeHref(next.tokenId) : "/extra-lives", action: next.claimable > 0n ? `$${fmtUsdc(next.claimable)} claimable now` : "Check claimable USDC" },
    { icon: <Icon name="store" size={20} />, title: "Transfer ownership", line: "Choose an asking price for your Life. A buyer inherits its remaining rights and unclaimed USDC. An exit requires a buyer.", href: next.tokenId ? lifeHref(next.tokenId) : "/market", action: next.tokenId ? "Review claim or sale" : "Explore the market" },
  ];
  return (
    <details className="panel mb-4 p-4" open={expanded} onToggle={event => { const open = event.currentTarget.open; setExpanded(open); try { localStorage.setItem(KEY, open ? "0" : "1"); } catch {} }}>
      <summary className="cursor-pointer text-sm font-bold marker:text-[var(--primary)]">
        How recovery works
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
