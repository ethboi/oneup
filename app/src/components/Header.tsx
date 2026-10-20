"use client";

import { useEffect, useState } from "react";
import { USDC, fmtUsdc, ONEUP } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";

export function Header() {
  const { o, d, me, setMe, accounts, tx, run } = useOneUp();
  const pool = usePoll(() => o.pool(), []);
  const epoch = usePoll(() => o.epoch(), []);
  const free = usePoll(() => o.balance(me), [me]);
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const oneup = usePoll(() => o.oneupBalance(me), [me]);
  const now = useNow();
  const left = epoch ? Math.max(0, epoch.started_at + d.epochLengthS - now) : 0;
  const [amount, setAmount] = useState("1000");
  const amt = BigInt(Math.floor(Number(amount) || 0)) * USDC;

  return (
    <header className="flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <div className="text-xl font-extrabold tracking-tight">OneUp</div>
          <div className="label">Lose a trade, get a life.</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Stat label="House pool" value={pool ? `$${fmtUsdc(BigInt(pool), 0)}` : "…"} />
        <Stat label={`Epoch ${epoch?.id ?? "…"} ends in`} value={fmtClock(left)} />
        <Stat label="Free balance" value={free ? `$${fmtUsdc(BigInt(free))}` : "…"} />
        <Stat label="Wallet" value={wallet ? `$${fmtUsdc(BigInt(wallet), 0)} · ${fmtOneup(oneup)} 1UP` : "…"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={me} onChange={(e) => setMe(e.target.value)} aria-label="Account">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.id}
            </option>
          ))}
        </select>
        <input className="input num w-24" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC amount" />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num text-lg font-semibold">{value}</div>
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

function Logo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <rect width="40" height="40" rx="10" fill="var(--accent)" />
      <path d="M8 22a12 12 0 0 1 24 0v2H8z" fill="#111" />
      <circle cx="15" cy="17" r="3" fill="var(--accent)" />
      <circle cx="25" cy="17" r="3" fill="var(--accent)" />
      <rect x="13" y="24" width="14" height="8" rx="2" fill="#111" />
    </svg>
  );
}
