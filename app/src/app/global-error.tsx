"use client";

// The last resort: an error nothing else caught replaces the whole page. It goes to Sentry, and the way back is a reload.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#15162a", color: "#fff", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24 }}>
        <main>
          <h1 style={{ fontSize: 22 }}>OneUp stopped working</h1>
          <p style={{ opacity: 0.8 }}>Something on this page failed. Your positions and balances are held by the contracts on chain, not by this page, and the keeper keeps running.</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 10, border: 0, background: "#c81e6c", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            Reload OneUp
          </button>
        </main>
      </body>
    </html>
  );
}
