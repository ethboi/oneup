import type { EpochEmissions } from "@oneup/sdk";

interface Source {
  emissions: (epoch: number) => Promise<EpochEmissions | null>;
  epochSummary: (epoch: number) => Promise<{ buyback_pot: string } | null>;
  buyback: (epoch: number) => Promise<{ usdc: string; status: unknown } | null>;
}

/** Keep completed history, while refreshing the latest epoch and unsettled buybacks. */
export class TokenomicsReader {
  private records = new Map<number, { emissions: EpochEmissions | null; buyback: { usdc: string; status: unknown } | null; settled: boolean }>();
  constructor(private source: Source) {}
  async read(lastEpoch: number) {
    const missing = Array.from({ length: Math.max(0, lastEpoch) }, (_, i) => i + 1).filter(id => {
      const row = this.records.get(id);
      return !row || id === lastEpoch || !row.settled;
    });
    // Bound fanout when opening a long-lived deployment for the first time.
    for (let i = 0; i < missing.length; i += 20) {
      await Promise.all(missing.slice(i, i + 20).map(async id => {
        const [emissions, buyback] = await Promise.all([this.source.emissions(id), this.source.buyback(id)]);
        const summary = buyback === null ? await this.source.epochSummary(id) : null;
        const settled = buyback?.status === "Done" || (summary !== null && BigInt(summary.buyback_pot) === 0n);
        this.records.set(id, { emissions, buyback, settled });
      }));
    }
    const rows = [...this.records.entries()].filter(([id]) => id <= lastEpoch).sort(([a], [b]) => a - b).map(([, row]) => row);
    return {
      history: rows.flatMap(row => row.emissions ? [row.emissions] : []),
      buybacks: rows.reduce((sum, row) => sum + BigInt(row.buyback?.usdc ?? 0), 0n),
    };
  }
}
