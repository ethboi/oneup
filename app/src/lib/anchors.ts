/** Follow a section that may appear only after a route's asynchronous data loads.
 * The caller cancels on navigation so a stale route can never steal the scroll. */
export function scrollToAnchorWhenReady(id: string, dom: {
  find: (id: string) => { scrollIntoView: (options: { block: "start" }) => void } | null;
  observe: (check: () => void) => () => void;
}): () => void {
  let cancelled = false;
  let stop = () => {};
  const check = () => {
    if (cancelled) return;
    const target = dom.find(id);
    if (!target) return;
    cancelled = true;
    stop();
    target.scrollIntoView({ block: "start" });
  };
  // Subscribe before checking, so insertion cannot fall between the two.
  stop = dom.observe(check);
  check();
  return () => { cancelled = true; stop(); };
}
