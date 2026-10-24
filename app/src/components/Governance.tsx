"use client";

// Who controls the house (D-20): a Sputnik DAO, running the same code as mainnet Sputnik v2 DAOs. Council
// members propose and vote; an approved proposal calls the house. Presets keep proposals to the house's
// own levers: list a market, pause or resume one, change its share of the pool.

import { useState } from "react";
import { houseProposal, type DaoProposal } from "@oneup/sdk";
import { useOneUp, usePoll } from "@/lib/oneup";
import { Icon } from "./Icon";

const short = (a: string) => a.replace(/\.test\.near$/, "");

/** Markets the DAO can list, with their Pyth feed ids (checked against benchmarks.pyth.network on 21 Oct
 *  2026). Prices come from the keeper's live source. */
const NEW_MARKETS = [
  { id: "SOL-USD", feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" },
  { id: "DOGE-USD", feedId: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c" },
];

export function Governance() {
  const { o, d, me, tx, run } = useOneUp();
  const policy = usePoll(() => o.daoPolicy(), [], 30_000);
  const proposals = usePoll(() => o.daoProposals(), [], 4000) ?? [];
  const owner = usePoll(() => o.owner(), [], 30_000);
  const markets = usePoll(() => o.markets(), [], 10_000) ?? [];
  const [preset, setPreset] = useState("list");
  const [market, setMarket] = useState("");
  const [capacity, setCapacity] = useState("40");
  if (!d.contracts.dao || !policy) return null;

  const council = policy.roles.flatMap((r) => (typeof r.kind === "object" && r.kind.Group ? r.kind.Group : []));
  const isCouncil = council.includes(me);
  const listable = NEW_MARKETS.filter((m) => !markets.some((x) => x.id === m.id));
  const target = market || (preset === "list" ? listable[0]?.id : markets[0]?.id) || "";

  const build = (): { description: string; kind: Record<string, unknown> } | null => {
    const h = d.contracts.house;
    if (preset === "list") {
      const m = NEW_MARKETS.find((x) => x.id === target);
      return m ? { description: `List ${m.id} with up to 1000× leverage`, kind: houseProposal(h, "add_market", { market_id: m.id, feed_id: m.feedId, max_leverage: 1000 }) } : null;
    }
    const m = markets.find((x) => x.id === target);
    if (!m) return null;
    if (preset === "leverage") {
      const lev = Math.max(1, Math.min(1000, Math.round(Number(capacity) || 0)));
      return { description: `Set maximum leverage for ${m.id} to ${lev}×`, kind: houseProposal(h, "set_max_leverage", { market_id: m.id, max_leverage: lev }) };
    }
    if (preset === "pause") {
      return { description: `${m.live ? "Pause" : "Resume"} ${m.id}`, kind: houseProposal(h, "set_market_live", { market_id: m.id, live: !m.live }) };
    }
    const pct = Math.max(1, Math.min(100, Number(capacity) || 0));
    return {
      description: `Set ${m.id} capacity to ${pct}% of the pool`,
      kind: houseProposal(h, "set_capacity", { market_id: m.id, capacity_ppm: String(pct * 10_000) }),
    };
  };
  const next = build();
  const options = preset === "list" ? listable.map((m) => m.id) : markets.map((m) => m.id);

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-extrabold">Who runs the house</h2>
        <span className="label num">
          Owner: {short(owner?.[0] ?? "…")} · Sputnik DAO
        </span>
      </div>
      <p className="label mt-1 max-w-3xl">
        A Sputnik DAO owns the house, using the same contract code as mainnet Sputnik v2 DAOs. Council members vote to
        list or pause markets and change each market’s share of the pool. Routine buybacks do not require a vote.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
        <span className="label mr-1">Council</span>
        {council.map((c) => (
          <span key={c} className="chip num" aria-current={c === me ? "true" : undefined}>
            {short(c)}
            {c === me && <span className="you-tag">you</span>}
          </span>
        ))}
      </div>

      {isCouncil && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Proposal type</span>
            <select className="input" value={preset} onChange={(e) => (setPreset(e.target.value), setMarket(""), setCapacity(e.target.value === "leverage" ? "1000" : "40"))}>
              <option value="list">List a market</option>
              <option value="pause">Pause or resume a market</option>
              <option value="capacity">Change a market&apos;s share of the pool</option>
              <option value="leverage">Change maximum leverage</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Market</span>
            <select className="input" value={target} onChange={(e) => setMarket(e.target.value)}>
              {options.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          {preset === "leverage" && (
            <label className="flex flex-col gap-1">
              <span className="label">Maximum leverage</span>
              <span className="field w-24">
                <input className="input num" value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="numeric" />
                <span className="field-unit">×</span>
              </span>
            </label>
          )}
          {preset === "capacity" && (
            <label className="flex flex-col gap-1">
              <span className="label">Pool share</span>
              <span className="field w-24">
                <input className="input num" value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="decimal" />
                <span className="field-unit">%</span>
              </span>
            </label>
          )}
          <button
            className="btn btn-accent"
            disabled={!next}
            onClick={() => next && run(`Propose: ${next.description}`, () => tx.propose(next.description, next.kind, BigInt(policy.proposal_bond)))}
          >
            Propose ({(Number(BigInt(policy.proposal_bond) / 10n ** 21n) / 1000).toString()} NEAR bond)
          </button>
        </div>
      )}

      <h3 className="mt-5 font-extrabold">Proposals ({proposals.length})</h3>
      <ul className="mt-1 flex flex-col">
        {proposals.length === 0 && <li className="label py-2">No proposals yet.</li>}
        {[...proposals].reverse().map((p) => (
          <ProposalRow key={p.id} p={p} canVote={isCouncil} seats={council.length} />
        ))}
      </ul>
    </div>
  );
}

function ProposalRow({ p, canVote, seats }: { p: DaoProposal; canVote: boolean; seats: number }) {
  const { me, tx, run } = useOneUp();
  const counts = Object.values(p.vote_counts)[0] ?? ["0", "0", "0"];
  const voted = p.votes[me];
  const colour = p.status === "Approved" ? "var(--long)" : p.status === "InProgress" ? "var(--info)" : p.status === "Rejected" ? "var(--short)" : "var(--muted)";
  const yes = Number(counts[0]);
  const no = Number(counts[1]);
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] py-2.5 text-sm">
      <span className="label num w-8">#{p.id}</span>
      <span className="min-w-0 flex-1">
        <b className="block">{p.description}</b>
        <span className="label flex items-center gap-2">
          by {short(p.proposer)}
          {/* one square per council seat: for, against, not yet voted */}
          <span className="inline-flex gap-0.5" aria-label={`${yes} votes for, ${no} against, with ${seats} council seats`} title={`${yes} for, ${no} against`}>
            {Array.from({ length: Math.max(seats, yes + no) }, (_, i) => (
              <span
                key={i}
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: i < yes ? "var(--long)" : i < yes + no ? "var(--short)" : "var(--line)" }}
              />
            ))}
          </span>
          <span className="num">
            {yes} for, {no} against
          </span>
        </span>
      </span>
      <span
        className="rounded-md px-2 py-0.5 text-xs font-extrabold"
        style={{ color: colour, background: `color-mix(in srgb, ${colour} 12%, transparent)` }}
      >
        {p.status === "InProgress" ? "Voting" : p.status === "Approved" ? "Approved and executed" : p.status}
      </span>
      {canVote && p.status === "InProgress" && !voted && (
        <span className="flex gap-1">
          <button className="btn btn-accent px-2.5 py-1" onClick={() => run(`Approve #${p.id}`, () => tx.vote(p.id, "VoteApprove", p.kind))}>
            <Icon name="check" size={14} /> Approve
          </button>
          <button className="btn btn-ghost px-2.5 py-1" onClick={() => run(`Reject #${p.id}`, () => tx.vote(p.id, "VoteReject", p.kind))}>
            Reject
          </button>
        </span>
      )}
      {voted && <span className="label">Your vote: {voted.toLowerCase()}</span>}
    </li>
  );
}
