"use client";

// Bringing money in from another chain, as NEAR Intents' 1Click API prices it: a real mainnet quote asked as a dry
// run (nothing is sent, and 1Click gives a dry run no deposit address), and a status check for a 1Click deposit
// address, with every status in plain words. OneUp runs on NEAR testnet and 1Click has no testnet, so nothing here
// can move funds into OneUp. Server side: app/api/oneclick, lib/server/oneclick.ts.

import { useState } from "react";
import { Icon } from "./Icon";
import { ORIGINS, STATUSES, aboutTime, statusMessage, summarize, type DryQuote, type StatusAnswer, type Tone } from "@/lib/oneclick";

const TONE: Record<Tone, string> = { wait: "var(--info)", good: "var(--long)", warn: "var(--jackpot)", bad: "var(--short)" };
const INTENTS_EXPLORER = "https://explorer.near-intents.org";

const dollars = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokens = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !j) throw new Error(j?.error ?? `The server answered ${r.status}`);
  return j;
}

/** The quote and the status check together, for the account menu and the trade screen. */
export function CrossChain() {
  return (
    <div className="flex flex-col gap-3">
      <p className="label">
        <span className="display mr-1.5 rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--text)]">DRY RUN</span>
        A real mainnet quote from NEAR Intents&apos; 1Click. It is never executed and sends nothing: OneUp runs on NEAR testnet, and 1Click has no testnet.
      </p>
      <QuoteForm />
      <div className="border-t border-[var(--line)] pt-3">
        <StatusCheck />
      </div>
    </div>
  );
}

function QuoteForm() {
  const [asset, setAsset] = useState<string>(ORIGINS[0].assetId);
  const [amount, setAmount] = useState<string>(ORIGINS[0].example);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<DryQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = ORIGINS.find((o) => o.assetId === asset) ?? ORIGINS[0];
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setQuote(await getJson<DryQuote>(`/api/oneclick/quote?asset=${encodeURIComponent(asset)}&amount=${encodeURIComponent(amount.trim())}`));
    } catch (e) {
      setQuote(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <select
          className="input min-w-0 flex-1"
          value={asset}
          aria-label="Asset and chain to bring in"
          onChange={(e) => {
            const next = ORIGINS.find((o) => o.assetId === e.target.value) ?? ORIGINS[0];
            setAsset(next.assetId);
            setAmount(next.example);
            setQuote(null);
            setError(null);
          }}
        >
          {ORIGINS.map((o) => (
            <option key={o.assetId} value={o.assetId}>
              {o.symbol} on {o.chain}
            </option>
          ))}
        </select>
        <span className="field w-28 shrink-0">
          <input
            className="input num"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void ask()}
            inputMode="decimal"
            aria-label={`Amount of ${origin.symbol}`}
          />
          <span className="field-unit">{origin.symbol}</span>
        </span>
      </div>
      <button type="button" className="btn btn-ghost" disabled={busy || !amount.trim()} onClick={() => void ask()}>
        {busy ? (
          <>
            <Icon name="spinner" /> Asking 1Click…
          </>
        ) : (
          "Get a dry-run quote"
        )}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[var(--short)]">
          {error}
        </p>
      )}
      {quote && <QuoteResult q={quote} />}
    </div>
  );
}

function QuoteResult({ q }: { q: DryQuote }) {
  const s = summarize(q);
  const at = clock(q.timestamp);
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-[var(--panel-2)] p-3" aria-live="polite">
      <p className="text-sm font-bold">
        What bringing {q.quote.amountInFormatted} {q.origin.symbol} from {q.origin.chain} into USDC on NEAR would cost
      </p>
      <dl className="num flex flex-col gap-1.5 text-sm">
        <div className="ticket-row">
          <dt className="label">You would receive</dt>
          <dd className="font-bold">{tokens(s.receive)} USDC</dd>
        </div>
        <div className="ticket-row">
          <dt className="label">At least, after 1% slippage</dt>
          <dd className="font-bold">{tokens(s.atLeast)} USDC</dd>
        </div>
        {s.cost !== null && (
          <div className="ticket-row">
            <dt className="label" title="Value in less value out, both at 1Click's own prices">
              Spread and fees
            </dt>
            <dd className="font-bold">
              {Math.abs(s.cost) < 0.005 ? "under $0.01" : s.cost < 0 ? `−${dollars(-s.cost)}` : dollars(s.cost)}
              {s.costPct !== null && <span className="font-normal text-[var(--muted)]"> ({s.costPct.toFixed(2)}%)</span>}
            </dd>
          </div>
        )}
        {s.feePct !== null && s.feePct > 0 && (
          <div className="ticket-row">
            <dt className="label">Fee named in the quote</dt>
            <dd className="font-bold">{s.feePct.toFixed(2)}%</dd>
          </div>
        )}
        {s.withdrawFee !== null && (
          <div className="ticket-row">
            <dt className="label">Withdrawal fee (already taken off)</dt>
            <dd className="font-bold">{tokens(s.withdrawFee)} USDC</dd>
          </div>
        )}
        {s.seconds !== null && (
          <div className="ticket-row">
            <dt className="label" title="Once the deposit confirms on its own chain">
              Time to arrive
            </dt>
            <dd className="font-bold">{aboutTime(s.seconds)}</dd>
          </div>
        )}
      </dl>
      <p className="label text-xs">
        {dollars(s.inUsd)} in and {dollars(s.outUsd)} out at 1Click&apos;s prices{at ? `, quoted at ${at}` : ""}; the time counts from when the deposit confirms. Not executed: this mainnet quote has no deposit address, so
        there is nowhere to send funds, and OneUp itself runs on testnet. OneUp asks without a 1Click API key; 1Click&apos;s docs say such quotes carry an extra fee,
        which is counted above.
      </p>
    </div>
  );
}

function StatusCheck() {
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<StatusAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const memoPart = memo.trim() ? `&depositMemo=${encodeURIComponent(memo.trim())}` : "";
      setAnswer(await getJson<StatusAnswer>(`/api/oneclick/status?depositAddress=${encodeURIComponent(address.trim())}${memoPart}`));
    } catch (e) {
      setAnswer(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const m = answer && statusMessage(answer);
  const updated = clock(answer?.updatedAt);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-bold">Check a 1Click deposit</p>
        <p className="label">Paste the deposit address a real 1Click quote gave you. OneUp only reads its status from 1Click.</p>
      </div>
      <input
        className="input num"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && address.trim() && !busy && void check()}
        placeholder="Deposit address"
        aria-label="1Click deposit address"
        spellCheck={false}
        autoComplete="off"
      />
      <input
        className="input num"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="Memo, only if the quote gave one"
        aria-label="Deposit memo (optional)"
        spellCheck={false}
        autoComplete="off"
      />
      <button type="button" className="btn btn-ghost" disabled={busy || !address.trim()} onClick={() => void check()}>
        {busy ? (
          <>
            <Icon name="spinner" /> Asking 1Click…
          </>
        ) : (
          "Check status"
        )}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[var(--short)]">
          {error}
        </p>
      )}
      {m && answer && (
        <div className="rounded-lg bg-[var(--panel-2)] p-3 text-sm" role="status">
          <p className="flex flex-wrap items-baseline gap-x-2 font-bold" style={{ color: TONE[m.tone] }}>
            {m.title}
            <span className="label num text-[11px] font-normal">{answer.status}</span>
          </p>
          <p className="mt-1">{m.text}</p>
          <p className="label mt-1.5 text-xs">
            {updated ? `Updated at ${updated}. ` : ""}
            {m.final ? "Nothing more will happen at this address." : "Check again later: this can still change."}{" "}
            <a className="underline" href={INTENTS_EXPLORER} target="_blank" rel="noreferrer">
              NEAR Intents Explorer
            </a>
          </p>
        </div>
      )}
      <details className="label text-xs">
        <summary className="cursor-pointer">What each status means</summary>
        <ul className="mt-2 flex flex-col gap-1.5">
          {STATUSES.map((s) => {
            const x = statusMessage({ status: s });
            return (
              <li key={s}>
                <b style={{ color: TONE[x.tone] }}>{x.title}</b> <span className="num">({s})</span>: {x.text}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
