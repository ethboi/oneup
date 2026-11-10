"use client";

// Under the header, only while reads of the chain have been failing for a while (lib/read-health.ts): says that
// what's on screen may be missing or out of date, and why, instead of leaving "…" unexplained. The first time it
// shows in a visit, Sentry hears about it once, so how often visitors hit this is known.

import * as Sentry from "@sentry/nextjs";
import { useEffect, useRef, useState } from "react";
import { useOneUp } from "@/lib/oneup";
import { stalledReads } from "@/lib/read-health";
import { Icon } from "./Icon";

export function ReadsNotice() {
  const { d } = useOneUp();
  const [stalled, setStalled] = useState(0);
  const reported = useRef(false);
  useEffect(() => {
    const check = () => {
      const { count, error } = stalledReads();
      setStalled(count);
      if (count > 0 && !reported.current) {
        reported.current = true;
        try {
          Sentry.captureMessage("Chain reads are not getting through", { level: "warning", tags: { reads: "stalled" }, extra: { count, error } });
        } catch {}
      }
    };
    const timer = setInterval(check, 2000);
    return () => clearInterval(timer);
  }, []);
  if (stalled === 0) return null;
  return (
    <p className="reads-notice label mx-auto mb-3 flex max-w-[1280px] items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 2xl:max-w-[1440px]" role="status">
      <Icon name="info" size={16} className="mt-0.5 shrink-0" />
      <span>
        <b className="text-[var(--text)]">Some live numbers aren&apos;t loading.</b>{" "}
        {d.network === "localnet"
          ? "The local chain isn't answering."
          : "The public NEAR testnet RPCs are refusing some of this browser's requests, usually a rate limit that clears within a minute."}{" "}
        What you see may be missing or out of date, and OneUp keeps retrying. Your positions and balances are held by the contracts on chain, not by this page.
      </span>
    </p>
  );
}
