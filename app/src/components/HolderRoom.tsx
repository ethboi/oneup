"use client";

// A Life's holder room: only the account that holds the Life right now can open it. The wallet signs a NEP-413
// message naming the Life (no transaction, no fee) and /api/life-holder checks it against the chain, so the room
// moves with the NFT.

import { useEffect, useState } from "react";
import { displayAccount, fmtUsdc } from "@oneup/sdk";
import { useOneUp } from "@/lib/oneup";
import { HOLDER_RECIPIENT, holderMessage, toBase64 } from "@/lib/nep413";
import { markHolderOpened } from "@/lib/tour";
import type { SinceHeld } from "@/lib/server/holder";
import { Icon } from "./Icon";

interface Room {
  holder: string;
  checkedAt: number;
  claimable: string;
  since: SinceHeld;
}

const day = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const usd = (raw: string | bigint) => `$${fmtUsdc(BigInt(raw))}`;

export function HolderRoom({ tokenId, owner }: { tokenId: string; owner: string }) {
  const { me, signMessage } = useOneUp();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // a different account, or a new owner, closes the room
  useEffect(() => {
    setRoom(null);
    setError(null);
  }, [me, owner, tokenId]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const message = holderMessage(tokenId, new Date());
      const signed = await signMessage({ message, recipient: HOLDER_RECIPIENT, nonce });
      const r = await fetch("/api/life-holder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: toBase64(nonce), message }),
      });
      const j = await r.json().catch(() => ({ error: "The server didn't answer." }));
      if (!r.ok) setError(j.error ?? "The room didn't open.");
      else {
        setRoom(j as Room);
        markHolderOpened((j as Room).holder);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 p-5">
      <h2 className="font-extrabold">Holder room</h2>
      <p className="text-sm text-[var(--muted)]">
        Only the account that holds this Life right now can open this. Your wallet signs a message naming the Life (no transaction, no fee), and the server checks the signature and that you hold the Life on chain. Sell it, and the room opens for the buyer, not for you.
      </p>
      {!room && (
        <>
          {!me ? (
            <p className="label">Connect the wallet that holds this Life to open it.</p>
          ) : (
            <>
              {me !== owner && <p className="label">It is held by {displayAccount(owner)}, so it will refuse you.</p>}
              <button className="btn btn-ghost" disabled={busy} onClick={open}>
                <Icon name={busy ? "spinner" : "lock"} />
                {busy ? "Waiting for your signature…" : "Open the holder room"}
              </button>
            </>
          )}
          {error && <p className="text-sm" style={{ color: "var(--short)" }}>{error}</p>}
        </>
      )}
      {room && <RoomView room={room} />}
    </div>
  );
}

function RoomView({ room }: { room: Room }) {
  const s = room.since;
  const got =
    s.how === "minted" ? `Minted to you on ${day(s.t!)}` :
    s.how === "bought" ? `Bought from ${displayAccount(s.from!)} on ${day(s.t!)} for ${usd(s.price!)}` :
    s.how === "received" ? `Sent to you by ${displayAccount(s.from!)} on ${day(s.t!)}` :
    "How it came to you is older than this Life's recorded history";
  const shared = s.shared.reduce((n, x) => n + BigInt(x.amount), 0n);
  const result = s.how === "bought" ? BigInt(s.claimed) + BigInt(room.claimable) - BigInt(s.price!) : null;
  return (
    <div className="panel space-y-3 p-4">
      <p className="label flex items-center gap-2">
        <Icon name="check" /> Open for {room.holder} · checked on chain at {day(room.checkedAt)}
      </p>
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div><dt className="label">How you got it</dt><dd className="mt-1 font-semibold">{got}</dd></div>
        <div><dt className="label">Unclaimed now</dt><dd className="mt-1 font-semibold">{usd(room.claimable)}</dd></div>
        <div>
          <dt className="label">Claimed since</dt>
          <dd className="mt-1 font-semibold">{usd(s.claimed)}</dd>
          {s.shared.length > 0 && <dd className="mt-1 text-[var(--muted)]">Plus {s.shared.length} claim{s.shared.length === 1 ? "" : "s"} together with other Lives, {usd(shared)} in all, which include this Life's share</dd>}
        </div>
        {result !== null && (
          <div>
            <dt className="label">Result so far</dt>
            <dd className="mt-1 font-semibold" style={{ color: result >= 0n ? "var(--long)" : "var(--short)" }}>{result >= 0n ? "+" : "−"}{usd(result >= 0n ? result : -result)}</dd>
            <dd className="mt-1 text-[var(--muted)]">Claimed plus unclaimed, less what you paid{s.shared.length ? ", not counting the shared claims" : ""}</dd>
          </div>
        )}
      </dl>
      <p className="text-xs text-[var(--muted)]">This view closes when you leave the page. Opening it again asks for a new signature, and the server checks ownership again each time.</p>
    </div>
  );
}
