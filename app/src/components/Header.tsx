"use client";

import { useEffect, useState } from "react";
import { USDC, fmtUsdc, ONEUP } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Logo, PixelCoin } from "./Pixel";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

export interface NavTab {
  name: string;
  badge?: "lives";
}

/** One bar: brand, the section tabs (desktop), the pool and the epoch clock as plain text, Demo, and your account. */
export function Header({ tabs, tab, go }: { tabs: readonly NavTab[]; tab: string; go: (t: string) => void }) {
  const { o, d, me } = useOneUp();
  const pool = usePoll(() => o.pool(), []);
  const epoch = usePoll(() => o.epoch(), []);
  const lives = usePoll(() => o.lives(me), [me]);
  const now = useNow();
  const left = epoch ? Math.max(0, epoch.started_at + d.epochLengthS - now) : 0;
  const alive = lives?.filter((l) => !l.expired && !l.full_heal).length ?? 0;

  return (
    <header className="mb-4 flex items-center gap-2 border-b border-[var(--line)] py-3 sm:gap-4 lg:mb-5">
      <div className="flex shrink-0 items-center gap-2">
        <Logo size={34} />
        <span className="display hidden text-[22px] leading-none sm:inline">OneUp</span>
      </div>
      <nav className="hidden min-w-0 flex-1 lg:block" aria-label="Sections">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.name} role="tab" aria-selected={tab === t.name} onClick={() => go(t.name)} className="tab">
              {t.name}
              {t.badge === "lives" && alive > 0 && <span className="tab-badge num">{alive}</span>}
            </button>
          ))}
        </div>
      </nav>
      <dl className="num flex min-w-0 flex-1 justify-end gap-4 text-right lg:flex-none">
        <div>
          <dt className="label leading-tight">Pool</dt>
          <dd className="font-extrabold leading-tight">{pool ? `$${fmtUsdc(BigInt(pool), 0)}` : "…"}</dd>
        </div>
        <div>
          <dt className="label leading-tight">Epoch {epoch?.id ?? "…"}</dt>
          <dd className="font-extrabold leading-tight">{fmtClock(left)}</dd>
        </div>
      </dl>
      <DemoMenu />
      <AccountMenu />
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

/** Your account: wallet and trading balances, and moving USDC between them. Trades top themselves up, so
 *  depositing first is optional. */
function AccountMenu() {
  const { o, me, tx, run } = useOneUp();
  const free = usePoll(() => o.balance(me), [me]);
  const wallet = usePoll(() => o.usdcBalance(me), [me]);
  const oneup = usePoll(() => o.oneupBalance(me), [me]);
  const [amount, setAmount] = useState("1000");
  const amt = BigInt(Math.floor(Number(amount) || 0)) * USDC;
  return (
    <Popover
      label="Account and funds"
      button={
        <>
          <Icon name="wallet" />
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm">{me.replace(/\.test\.near$/, "")}</span>
            <span className="label num block font-normal">${wallet ? fmtUsdc(BigInt(wallet), 0) : "…"}</span>
          </span>
        </>
      }
    >
      {() => (
        <div className="flex flex-col gap-3">
          <dl className="num grid grid-cols-2 gap-y-1 text-sm">
            <dt className="label">Wallet</dt>
            <dd className="text-right font-bold">${wallet ? fmtUsdc(BigInt(wallet)) : "…"}</dd>
            <dt className="label">Trading balance</dt>
            <dd className="flex items-center justify-end gap-1.5 font-bold">
              <PixelCoin size={14} />${free ? fmtUsdc(BigInt(free)) : "…"}
            </dd>
            <dt className="label">$1UP</dt>
            <dd className="text-right font-bold">{fmtOneup(oneup)}</dd>
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
