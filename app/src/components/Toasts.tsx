"use client";

import { useOneUp } from "@/lib/oneup";
import { Icon } from "./Icon";

export function Toasts() {
  const { toasts } = useOneUp();
  return (
    <div className="fixed bottom-[140px] right-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 lg:bottom-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="panel px-4 py-3 text-sm font-bold shadow-[var(--panel-shadow)]"
          style={{ borderColor: t.kind === "error" ? "var(--short)" : t.kind === "ok" ? "var(--long)" : "var(--line)" }}
        >
          <span className="mr-2 inline-flex align-[-3px]" style={{ color: t.kind === "ok" ? "var(--long)" : t.kind === "error" ? "var(--short)" : "var(--muted)" }}>
            <Icon name={t.kind === "pending" ? "spinner" : t.kind === "ok" ? "check" : "x"} />
          </span>
          {t.text}
        </div>
      ))}
    </div>
  );
}
