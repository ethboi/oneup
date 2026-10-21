"use client";

// Small shared pieces so every tab is built the same way: a section heading with an optional action, a
// one-line explainer that opens into "How it works", and a summary row of stats. A tab's summary, status and
// rows sit in one panel, split by hairlines (PanelHead names each group), rather than a box per piece.

import { useState } from "react";
import { Icon } from "./Icon";

export function Section({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One plain line; the longer explanation stays folded until asked for. */
export function Explainer({ line, children }: { line: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm text-[var(--muted)]">
      <p>
        {line}{" "}
        <button type="button" className="font-bold text-[var(--text)] underline decoration-dotted underline-offset-2" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide" : "How it works"}
        </button>
      </p>
      {open && <div className="mt-2 max-w-3xl rounded-lg bg-[var(--panel-2)] p-3 leading-relaxed">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className="num truncate text-xl font-extrabold" style={tone ? { color: tone === "good" ? "var(--long)" : "var(--short)" } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** Stats in a row (two columns on phones), with the main action at the end. Sits at the top of a panel. */
export function SummaryBar({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Empty({ icon, children }: { icon: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 p-4 text-sm text-[var(--muted)]">
      <Icon name={icon} size={20} />
      <div>{children}</div>
    </div>
  );
}

/** A group's name inside a panel, with an optional action (Show / Hide). */
export function PanelHead({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-4 pt-2">
      <h3 className="font-extrabold">{title}</h3>
      {action}
    </div>
  );
}
