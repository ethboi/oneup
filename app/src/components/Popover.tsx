"use client";

// A button that opens a small panel under it; closes on an outside click or Escape.

import { useEffect, useRef, useState } from "react";

export function Popover({
  button,
  label,
  align = "right",
  small,
  children,
}: {
  button: React.ReactNode;
  label: string;
  align?: "left" | "right";
  /** An icon-sized trigger, for use inside rows. */
  small?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className={`btn btn-ghost ${small ? "px-2 py-1" : ""}`} aria-expanded={open} aria-haspopup="dialog" aria-label={label} onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`absolute top-full z-50 mt-2 w-[min(320px,calc(100vw-32px))] rounded-xl border border-[var(--panel-edge)] bg-[var(--panel)] p-3 shadow-[var(--panel-shadow)] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
