/** One request at a time; cancelled generations may never publish or schedule another request. */
export function pollSerial<T>(load: () => Promise<T>, publish: (value: T) => void, ms: number,
  schedule: (f: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try { const value = await load(); if (active) publish(value); }
    catch { /* Retry on the next poll; keep the last value for this identity. */ }
    finally { if (active) timer = schedule(() => { void tick(); }, ms); }
  };
  void tick();
  return () => { active = false; if (timer !== undefined) cancel(timer); };
}
