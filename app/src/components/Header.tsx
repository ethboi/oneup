"use client";

import { useEffect, useState } from "react";
import { USDC, fmtUsdc, ONEUP } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Logo, PixelCoin, PixelHeart } from "./Pixel";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

export function Header() {
  const { o, d, me } = useOneUp();
  const pool = usePoll(() => o.pool(), []);
  const epoch = usePoll(() => o.epoch(), []);
  const free = usePoll(() => o.balance(me), [me]);
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const oneup = usePoll(() => o.oneupBalance(me), [me]);
  const lives = usePoll(() => o.lives(me), [me]);
  const now = useNow();
  const left = epoch ? Math.max(0, epoch.started_at + d.epochLengthS - now) : 0;
  const alive = lives?.filter((l) => !l.expired && !l.full_heal).length;

  return (
    // One row: brand, then three controls (Demo, account, Funds); the HUD below. Same on phones.
    <header className="flex flex-col gap-3 py-4 lg:py-5">
      <div className="flex items-center gap-2 sm:gap-3">
        <Logo size={40} />
        <div className="min-w-0 flex-1">
          <div className="display text-[26px] leading-none">OneUp</div>
          <div className="label mt-1 hidden sm:block">Lose a trade, get a life.</div>
        </div>
        <DemoMenu />
        <div className="hidden min-w-0 rounded-[10px] border border-[var(--panel-edge)] bg-[var(--panel)] px-3 py-1.5 text-right sm:block">
          <div className="truncate text-sm font-extrabold">{me.replace(/\.test\.near$/, "")}</div>
          <div className="label num">
            ${wallet ? fmtUsdc(BigInt(wallet), 0) : "…"} USDC · {fmtOneup(oneup)} $1UP
          </div>
        </div>
        <Funds free={free} wallet={wallet} />
      </div>

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-[var(--line)] sm:grid-cols-4">
        <Stat label="House pool" value={pool ? `$${fmtUsdc(BigInt(pool), 0)}` : "…"} />
        <Stat label={`Epoch ${epoch?.id ?? "…"} ends in`} value={fmtClock(left)} />
        <Stat label="Trading balance" value={free ? `$${fmtUsdc(BigInt(free))}` : "…"} icon={<PixelCoin size={16} />} />
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
    </header>
  );
}

/** Localnet tools: act as any demo account, and get test USDC. */
function DemoMenu() {
  const { me, setMe, accounts, tx, run } = useOneUp();
  const [amount, setAmount] = useState("10000");
  const amt = BigInt(Math.floor(Number(amount) || 0)) * USDC;
  return (
    <Popover
      label="Demo tools"
      button={
        <>
          <Icon name="demo" />
          <span className="hidden sm:inline">Demo</span>
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <div className="label">Local demo: switch accounts and get test USDC.</div>
          <label className="flex flex-col gap-1">
            <span className="label">Act as</span>
            <select className="input" value={me} onChange={(e) => (setMe(e.target.value), close())} aria-label="Account">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <span className="field flex-1">
              <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Faucet amount" inputMode="decimal" />
              <span className="field-unit">USDC</span>
            </span>
            <button className="btn btn-ghost" disabled={amt === 0n} onClick={() => run(`Faucet ${amount} USDC`, () => tx.faucet(amt))}>
              <Icon name="faucet" />
              Faucet
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Move USDC between the wallet and the trading balance. Trades top themselves up, so this is optional. */
function Funds({ free, wallet }: { free?: string; wallet?: string }) {
  const { tx, run } = useOneUp();
  const [amount, setAmount] = useState("1000");
  const amt = BigInt(Math.floor(Number(amount) || 0)) * USDC;
  return (
    <Popover
      label="Funds"
      button={
        <>
          <Icon name="wallet" />
          <span className="hidden sm:inline">Funds</span>
        </>
      }
    >
      {() => (
        <div className="flex flex-col gap-3">
          <dl className="num grid grid-cols-2 gap-y-1 text-sm">
            <dt className="label">Wallet</dt>
            <dd className="text-right font-bold">${wallet ? fmtUsdc(BigInt(wallet)) : "…"}</dd>
            <dt className="label">Trading balance</dt>
            <dd className="text-right font-bold">${free ? fmtUsdc(BigInt(free)) : "…"}</dd>
          </dl>
          <span className="field">
            <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC amount" inputMode="decimal" />
            <span className="field-unit">USDC</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-accent" disabled={amt === 0n} onClick={() => run(`Deposit ${amount} USDC`, () => tx.deposit(amt))}>
              <Icon name="deposit" />
              Deposit
            </button>
            <button className="btn btn-ghost" disabled={amt === 0n} onClick={() => run(`Withdraw ${amount} USDC`, () => tx.withdraw(amt))}>
              <Icon name="withdraw" />
              Withdraw
            </button>
          </div>
          <p className="label">Optional: placing a trade moves what it needs from your wallet in the same step.</p>
        </div>
      )}
    </Popover>
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
