import { pollSerial } from "./poll.ts";

/** Serial loads and a monotonic cursor; repeated/reordered responses cannot duplicate feed entries. */
export function pollActivity<T extends { seq: number }>(load: (after: number) => Promise<T[]>,
  publish: (items: T[]) => void, keep: number, ms = 2000,
  schedule?: Parameters<typeof pollSerial>[3], cancel?: Parameters<typeof pollSerial>[4]) {
  let after = 0;
  let items: T[] = [];
  return pollSerial(() => load(after), fresh => {
    const accepted = fresh.filter(x => Number.isSafeInteger(x.seq) && x.seq > after);
    if (!accepted.length) return;
    const unique = new Map([...items, ...accepted].map(x => [x.seq, x]));
    after = Math.max(after, ...accepted.map(x => x.seq));
    items = [...unique.values()].sort((a, b) => b.seq - a.seq).slice(0, keep);
    publish(items);
  }, ms, schedule, cancel);
}
