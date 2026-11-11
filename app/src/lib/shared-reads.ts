// One request for a question asked twice at the same moment. The header, the order form, the walkthrough and the
// sounds each ask the chain for the account's Lives, the round and the rest on timers of their own, and after a
// transaction they all ask again together: a Trade page sent about 300 requests a minute, most of them repeats.
// Public testnet RPCs limit each IP by request, so a page that sends each question once is refused less often.

export class ReadShare {
  private readonly held = new Map<string, { at: number; answer: Promise<unknown> }>();

  constructor(
    /** How long an answer stands in for a new request. Well under the quickest poll, so no poll gets an old answer twice. */
    private readonly holdMs = 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** The answer to `key`: the one asked for within the last `holdMs` when there is one (arrived or still on its
   *  way), otherwise a new request. A request that failed is forgotten, so the next asker tries again. */
  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const t = this.now();
    const h = this.held.get(key);
    if (h && t - h.at < this.holdMs) return h.answer as Promise<T>;
    // questions with typed-in numbers in them (a quote for each margin tried) would otherwise pile up
    if (this.held.size >= 300) for (const [k, v] of this.held) if (t - v.at >= this.holdMs) this.held.delete(k);
    const answer = load();
    this.held.set(key, { at: t, answer });
    answer.catch(() => {
      if (this.held.get(key)?.answer === answer) this.held.delete(key);
    });
    return answer;
  }

  /** After a transaction, what was read before it is out of date: every question goes to the chain again. */
  clear() {
    this.held.clear();
  }
}
