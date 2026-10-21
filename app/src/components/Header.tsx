"use client";

import { useEffect, useState } from "react";
import { USDC, fmtUsdc, ONEUP } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Logo, PixelCoin, PixelHeart } from "./Pixel";

export function Header() {
  const { o, d, me, setMe, accounts, tx, run } = useOneUp();
  const pool = usePoll(() => o.pool(), []);
  const epoch = usePoll(() => o.epoch(), []);
  const free = usePoll(() => o.balance(me), [me]);
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const oneup = usePoll(() => o.oneupBalance(me), [me]);
  const lives = usePoll(() => o.lives(me), [me]);
  const now = useNow();
  const left = epoch ? Math.max(0, epoch.started_at + d.epochLengthS - now) : 0;
  const [amount, setAmount] = useState("1000");
  const amt = BigInt(Math.floor(Number(amount) || 0)) * USDC;
  const [open, setOpen] = useState(false);
  const alive = lives?.filter((l) => !l.expired && !l.full_heal).length;

  return (
    // Phones: brand + Wallet button, the HUD, then the funds controls when opened.
    // Desktop: brand and controls on one row, the HUD below.
    <header className="flex flex-col gap-3 py-4 lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-x-6 lg:gap-y-4 lg:py-5">
      <div className="flex items-center gap-3 lg:col-start-1 lg:row-start-1">
        <Logo size={40} />
        <div className="flex-1">
          <div className="display text-[26px] leading-none">OneUp</div>
          <div className="label mt-1">Lose a trade, get a life.</div>
        </div>
        <button className="btn btn-ghost lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Done" : "Wallet"}
        </button>
      </div>

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-[var(--edge)] sm:grid-cols-4 lg:col-span-2 lg:row-start-2">
        <Stat label="House pool" value={pool ? `$${fmtUsdc(BigInt(pool), 0)}` : "…"} />
        <Stat label={`Epoch ${epoch?.id ?? "…"} ends in`} value={fmtClock(left)} />
        <Stat label="Free balance" value={free ? `$${fmtUsdc(BigInt(free))}` : "…"} icon={<PixelCoin size={16} />} />
        <Stat
          label="Extra Lives"
          value={alive === undefined ? "…" : `×${alive}`}
          icon={
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <PixelHeart key={i} size={16} fill={alive !== undefined && i < alive ? 1 : 0} />
              ))}
            </span>
          }
        />
      </div>

      <div className={`${open ? "grid" : "hidden"} grid-cols-3 gap-2 lg:col-start-2 lg:row-start-1 lg:flex lg:items-center`}>
        <div className="label col-span-3 num lg:mr-2 lg:text-right">
          Wallet ${wallet ? fmtUsdc(BigInt(wallet), 0) : "…"} USDC
          <br className="hidden lg:block" /> and {fmtOneup(oneup)} $1UP
        </div>
        <select className="input col-span-3 lg:w-auto" value={me} onChange={(e) => setMe(e.target.value)} aria-label="Account">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}
            </option>
          ))}
        </select>
        <input className="input num col-span-3 lg:w-24" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC amount" inputMode="decimal" />
        <button className="btn btn-ghost" onClick={() => run(`Faucet ${amount} USDC`, () => tx.faucet(amt))}>
          Faucet
        </button>
        <button className="btn btn-accent" disabled={amt === 0n} onClick={() => run(`Deposit ${amount} USDC`, () => tx.deposit(amt))}>
          Deposit
        </button>
        <button className="btn btn-ghost" disabled={amt === 0n} onClick={() => run(`Withdraw ${amount} USDC`, () => tx.withdraw(amt))}>
          Withdraw
        </button>
      </div>
    </header>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-[var(--panel)] px-4 py-2.5">
      <div className="label truncate">{label}</div>
      <div className="mt-0.5 flex items-center gap-2">
        {icon}
        <span className="display num truncate text-xl leading-tight">{value}</span>
      </div>
    </div>
  );
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(i);
  }, [ms]);
  return now;
}

export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
export const fmtOneup = (x?: string, digits = 0) =>
  x === undefined ? "…" : (Number(BigInt(x) / (ONEUP / 1000n)) / 1000).toLocaleString("en-US", { maximumFractionDigits: digits });
