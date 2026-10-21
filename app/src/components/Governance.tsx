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
      return m ? { description: `List ${m.id} at up to 100×`, kind: houseProposal(h, "add_market", { market_id: m.id, feed_id: m.feedId, max_leverage: 100 }) } : null;
    }
    const m = markets.find((x) => x.id === target);
    if (!m) return null;
    if (preset === "pause") {
      return { description: `${m.live ? "Pause" : "Resume"} ${m.id}`, kind: houseProposal(h, "set_market_live", { market_id: m.id, live: !m.live }) };
    }
    const pct = Math.max(1, Math.min(100, Number(capacity) || 0));
    return {
      description: `Give ${m.id} ${pct}% of the pool`,
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
          Owner {short(owner?.[0] ?? "…")} · Sputnik DAO
        </span>
      </div>
      <p className="label mt-1 max-w-3xl">
        A Sputnik DAO (the same code as mainnet Sputnik v2 DAOs) owns the house: listing markets, pausing them and their share of the
        pool all go through a council vote. Council: {council.map(short).join(", ")}. Routine buybacks run without a vote.
      </p>

      {isCouncil && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Propose</span>
            <select className="input" value={preset} onChange={(e) => (setPreset(e.target.value), setMarket(""))}>
              <option value="list">List a market</option>
              <option value="pause">Pause or resume a market</option>
              <option value="capacity">Change a market&apos;s share of the pool</option>
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
          {preset === "capacity" && (
            <label className="flex flex-col gap-1">
              <span className="label">Share</span>
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

      <ul className="mt-4 flex flex-col">
        {proposals.length === 0 && <li className="label">No proposals yet.</li>}
        {[...proposals].reverse().map((p) => (
          <ProposalRow key={p.id} p={p} canVote={isCouncil} />
        ))}
      </ul>
    </div>
  );
}

function ProposalRow({ p, canVote }: { p: DaoProposal; canVote: boolean }) {
  const { me, tx, run } = useOneUp();
  const counts = Object.values(p.vote_counts)[0] ?? ["0", "0", "0"];
  const voted = p.votes[me];
  const colour = p.status === "Approved" ? "var(--long)" : p.status === "InProgress" ? "var(--info)" : "var(--muted)";
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] py-2.5 text-sm">
      <span className="label num w-8">#{p.id}</span>
      <span className="min-w-0 flex-1">
        <b className="block">{p.description}</b>
        <span className="label">
          by {short(p.proposer)} · {counts[0]} for, {counts[1]} against
        </span>
      </span>
      <span className="text-xs font-extrabold" style={{ color: colour }}>
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
      {voted && <span className="label">You voted {voted.toLowerCase()}</span>}
    </li>
  );
}
