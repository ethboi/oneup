"use client";

import { useEffect, useState } from "react";
import { ONEUP, PPM, USDC, fmtUsdc, type LockInfo } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { fmtOneup } from "./Header";

export function Vote() {
  const { o, me } = useOneUp();
  const locks = usePoll(() => o.locks(me), [me]) ?? [];
  const markets = usePoll(() => o.markets(), [], 5000) ?? [];
  const proposals = usePoll(() => o.proposals(), [], 5000) ?? [];
  const choices = [...markets.map((m) => m.id), ...proposals.map((p) => p.market_id)];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Shares />
        <div className="font-semibold">Your locks</div>
        {locks.length === 0 && <p className="label">No locks yet. Lock $1UP to vote and earn from the markets you back.</p>}
        {locks.map((l) => (
          <LockCard key={l.token_id} l={l} choices={choices} />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <LockForm />
        <Proposals />
        <Bribe choices={choices} />
      </div>
    </div>
  );
}

function Shares() {
  const { o } = useOneUp();
  const shares = usePoll(() => o.voteShares(), []) ?? [];
  const pending = usePoll(() => o.pendingVotes(), []) ?? [];
  const total = pending.reduce((s, [, v]) => s + BigInt(v), 0n);
  const rows = new Map<string, { now: number; next: number }>();
  for (const [m, s] of shares) rows.set(m, { now: Number(s) / 1e4, next: 0 });
  for (const [m, v] of pending) {
    const r = rows.get(m) ?? { now: 0, next: 0 };
    r.next = total ? Number((BigInt(v) * 10_000n) / total) / 100 : 0;
    rows.set(m, r);
  }
  return (
    <div className="panel p-4">
      <div className="font-semibold">Where the house&apos;s money goes</div>
      <p className="label mb-3">Each market&apos;s share of the pool&apos;s capacity and of $1UP emissions, now and from next epoch.</p>
      <div className="flex flex-col gap-2">
        {[...rows.entries()].map(([m, r]) => (
          <div key={m} className="grid grid-cols-[110px_1fr_110px] items-center gap-3 text-sm">
            <span>{m}</span>
            <div className="relative h-3 rounded-full bg-[var(--panel-2)]">
              <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${r.now}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full border-2 border-[var(--info)]" style={{ width: `${r.next}%` }} />
            </div>
            <span className="num text-right">
              {r.now.toFixed(1)}% → <span className="text-[var(--info)]">{r.next.toFixed(1)}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LockCard({ l, choices }: { l: LockInfo; choices: string[] }) {
  const { o, tx, run } = useOneUp();
  const epoch = usePoll(() => o.epoch(), []);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  useEffect(() => {
    setAlloc(Object.fromEntries(l.votes.map(([m, a]) => [m, String(Number(a) / 1e4)])));
  }, [l.token_id, l.votes.map(([m, a]) => m + a).join()]);
  const pastEpochs = epoch ? Array.from({ length: Math.min(20, epoch.id - 1) }, (_, i) => epoch.id - 1 - i) : [];
  const claimable = usePoll(() => o.veClaimable(l.token_id, pastEpochs), [l.token_id, epoch?.id]) ?? [];
  const sum = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
  const entries = Object.entries(alloc).filter(([, v]) => Number(v) > 0);

  const submit = () => {
    // percentages → ppm, last market takes the rounding so they sum to exactly 1e6
    let left = PPM;
    const out: [string, bigint][] = entries.map(([m, v], i) => {
      const a = i === entries.length - 1 ? left : BigInt(Math.round(Number(v) * 1e4));
      left -= a;
      return [m, a];
    });
    return run(`Vote with lock #${l.token_id}`, () => tx.vote(l.token_id, out));
  };

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold">ve1UP #{l.token_id}</div>
        <div className="label num">
          {fmtOneup(l.amount)} $1UP locked · power {fmtOneup(l.power)} · ends epoch {l.end}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {choices.map((m) => (
          <label key={m} className="flex items-center justify-between gap-2 text-sm">
            <span>{m}</span>
            <span className="flex items-center gap-1">
              <input
                className="input num w-20 text-right"
                value={alloc[m] ?? ""}
                placeholder="0"
                onChange={(e) => setAlloc({ ...alloc, [m]: e.target.value })}
              />
              %
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="label num" style={{ color: Math.abs(sum - 100) < 0.01 ? undefined : "var(--short)" }}>
          Total {sum.toFixed(1)}% · counts from next epoch
        </span>
        <div className="flex gap-2">
          <button
            className="btn btn-ghost"
            disabled={claimable.length === 0}
            onClick={() => run(`Claim rewards #${l.token_id}`, () => tx.claimVe(l.token_id, pastEpochs))}
          >
            Claim {claimable.map(([t, a]) => (t === o.d.contracts.usdc ? `$${fmtUsdc(BigInt(a))}` : `${fmtOneup(a, 2)} 1UP`)).join(" + ") || "rewards"}
          </button>
          <button className="btn btn-accent" disabled={Math.abs(sum - 100) > 0.01 || entries.length === 0} onClick={submit}>
            Vote
          </button>
        </div>
      </div>
    </div>
  );
}

function LockForm() {
  const { tx, run } = useOneUp();
  const [amount, setAmount] = useState("1000");
  const [epochs, setEpochs] = useState(52);
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="font-semibold">Lock $1UP</div>
      <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="$1UP amount" />
      <label className="flex flex-col gap-1">
        <span className="label flex justify-between">
          <span>Lock for</span>
          <span className="num text-[var(--text)]">{epochs} epochs</span>
        </span>
        <input type="range" min={1} max={52} value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} />
      </label>
      <p className="label num">Voting power {((Number(amount) || 0) * epochs / 52).toLocaleString("en-US", { maximumFractionDigits: 0 })}, shrinking each epoch.</p>
      <button
        className="btn btn-accent"
        onClick={() => run(`Lock ${amount} $1UP`, () => tx.lock(BigInt(Math.floor(Number(amount) || 0)) * ONEUP, epochs))}
      >
        Lock
      </button>
    </div>
  );
}

function Proposals() {
  const { o, tx, run } = useOneUp();
  const proposals = usePoll(() => o.proposals(), [], 5000) ?? [];
  const [market, setMarket] = useState("");
  const [feed, setFeed] = useState("");
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="font-semibold">New markets</div>
      {proposals.map((p) => (
        <div key={p.market_id} className="text-sm">
          <span className="font-semibold">{p.market_id}</span> <span className="label">needs 2% of votes · idle {p.idle}/4</span>
        </div>
      ))}
      <input className="input" value={market} onChange={(e) => setMarket(e.target.value.toUpperCase())} placeholder="Market, e.g. DOGE-USD" />
      <input className="input" value={feed} onChange={(e) => setFeed(e.target.value)} placeholder="Pyth feed id (hex)" />
      <button className="btn btn-ghost" disabled={!market || !feed} onClick={() => run(`Propose ${market}`, () => tx.propose(market, feed))}>
        Propose with a 500 USDC bond
      </button>
    </div>
  );
}

function Bribe({ choices }: { choices: string[] }) {
  const { d, tx, run } = useOneUp();
  const [market, setMarket] = useState(choices[0] ?? "");
  const [token, setToken] = useState<"usdc" | "oneup">("usdc");
  const [amount, setAmount] = useState("100");
  const raw = BigInt(Math.floor(Number(amount) || 0)) * (token === "usdc" ? USDC : ONEUP);
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="font-semibold">Bribe voters</div>
      <p className="label">Paid to next epoch&apos;s voters of the market, in proportion to their votes.</p>
      <select className="input" value={market} onChange={(e) => setMarket(e.target.value)}>
        {choices.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Bribe amount" />
        <select className="input w-28" value={token} onChange={(e) => setToken(e.target.value as "usdc" | "oneup")}>
          <option value="usdc">USDC</option>
          <option value="oneup">$1UP</option>
        </select>
      </div>
      <button
        className="btn btn-ghost"
        disabled={!market || raw === 0n}
        onClick={() => run(`Bribe ${amount} on ${market}`, () => tx.bribe(token === "usdc" ? d.contracts.usdc : d.contracts.oneup, market, raw))}
      >
        Bribe
      </button>
    </div>
  );
}
