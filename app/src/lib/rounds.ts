"use client";

import { useEffect, useState } from "react";
import { useOneUp } from "./oneup";
import type { PublishedRounds } from "./tokenomics";

/**
 * Closed rounds as the testnet indexer published them (/api/rounds): one request, instead of asking a public RPC
 * about every round. `undefined` while loading; `null` when nothing is published (the local demo, or a testnet run
 * without the indexer's store), and the page then reads the chain itself.
 */
export function usePublishedRounds(): PublishedRounds | null | undefined {
  const { d } = useOneUp();
  const local = d.network === "localnet";
  const [rounds, setRounds] = useState<PublishedRounds | null>();
  useEffect(() => {
    if (local) return;
    let live = true;
    const tick = () =>
      fetch("/api/rounds")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: PublishedRounds | null) => live && setRounds(j))
        // keep what was last read; the next tick asks again
        .catch(() => {});
    void tick();
    const timer = setInterval(tick, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [local]);
  return local ? null : rounds;
}
