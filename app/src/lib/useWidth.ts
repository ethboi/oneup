"use client";

import { useEffect, useState } from "react";

/**
 * Callback ref + the element's measured width, so charts draw at real pixels (text stays readable on a
 * phone instead of shrinking with a viewBox). A callback ref follows the element when a placeholder swaps out.
 */
export function useWidth(initial = 760) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}
