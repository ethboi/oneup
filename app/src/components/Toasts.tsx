"use client";

import { useOneUp } from "@/lib/oneup";

export function Toasts() {
  const { toasts } = useOneUp();
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="panel px-4 py-3 text-sm font-bold shadow-[0_4px_0_var(--depth)]"
          style={{ borderColor: t.kind === "error" ? "var(--short)" : t.kind === "ok" ? "var(--long)" : "var(--line)" }}
        >
          <span className="mr-2">{t.kind === "pending" ? "…" : t.kind === "ok" ? "✓" : "✕"}</span>
          {t.text}
        </div>
      ))}
    </div>
  );
}
