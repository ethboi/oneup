/** Restart-safe reconciliation. Chain status is authoritative; the file is only a work queue. */
export interface BuybackQueue { nextEpoch: number; pending: number[] }
type Status = "Pending" | "Swapping" | "Done" | { DeliveryPending: { remaining: string } } | { Delivering: { amount: string } };
export interface BuybackPort {
  read(epoch: number): Promise<{ status: Status; usdc: string } | null>;
  quote(usdc: string): Promise<bigint>;
  swap(epoch: number, minOut: bigint): Promise<unknown>;
  deliver(epoch: number): Promise<unknown>;
}

/** At most scan new epochs and attempts existing entries per tick. In-flight receipts are never replayed.
 * Failed entries rotate behind others. A lost/corrupt checkpoint safely reconstructs from epoch zero. */
export async function reconcileBuybacks(port: BuybackPort, queue: BuybackQueue, closedBefore: number,
  save: (queue: BuybackQueue) => void, log: (message: string) => void,
  scan = 20, attempts = 3): Promise<void> {
  for (let n = 0; n < scan && queue.nextEpoch < closedBefore; n++) {
    try {
      const b = await port.read(queue.nextEpoch);
      if (b && b.status !== "Done") queue.pending.push(queue.nextEpoch);
      queue.nextEpoch++;
    } catch (e) {
      log(`buyback discovery ${queue.nextEpoch}: ${String(e)}`);
      break; // preserve cursor; an unavailable view must not silently skip history
    }
  }
  const count = Math.min(attempts, queue.pending.length);
  for (let n = 0; n < count; n++) {
    const epoch = queue.pending[0];
    let finished = false;
    try {
      const b = await port.read(epoch);
      if (!b || b.status === "Done") finished = true;
      else if (b.status === "Pending") {
        const quote = await port.quote(b.usdc);
        if (quote > 0n) await port.swap(epoch, (quote * 98n / 100n) || 1n);
      } else if (typeof b.status === "object" && "DeliveryPending" in b.status) {
        await port.deliver(epoch);
      }
    } catch (e) { log(`buyback ${epoch}: ${e instanceof Error ? e.message : String(e)}`); }
    queue.pending.shift();
    if (!finished) queue.pending.push(epoch);
  }
  save(queue);
}

export function restoreBuybacks(value: unknown, identity: string): BuybackQueue {
  const v = value as { identity?: string; nextEpoch?: number; pending?: number[] } | null;
  if (v?.identity !== identity || !Number.isSafeInteger(v.nextEpoch) || v.nextEpoch! < 0 ||
    !Array.isArray(v.pending) || v.pending.some(e => !Number.isSafeInteger(e) || e < 0 || e >= v.nextEpoch!) ||
    new Set(v.pending).size !== v.pending.length) return { nextEpoch: 0, pending: [] };
  return { nextEpoch: v.nextEpoch!, pending: [...v.pending] };
}
