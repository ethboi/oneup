"use client";

// First visit: the whole idea in three steps. Gone once dismissed (remembered in this browser) or once the
// account has traded: by then it knows.

import { useEffect, useState } from "react";
import { useOneUp, usePoll } from "@/lib/oneup";
import { useHistory } from "./History";
import { Icon } from "./Icon";
import { PixelHeart } from "./Pixel";

const KEY = "oneup.onboarded";

export function Onboarding() {
  const { o, me } = useOneUp();
  const positions = usePoll(() => o.positions(me), [me]);
  const history = useHistory(me);
  const traded = (positions?.length ?? 0) > 0 || (history?.items ?? []).some((i) => i.kind === "trade");
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show || traded) return null;
  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  };
  const steps = [
    { icon: <Icon name="chart" size={20} />, title: "Trade against the house", line: "Trade at oracle prices. Winners pay a 10–25% cut; no entry or funding fee." },
    { icon: <PixelHeart size={20} />, title: "Lose? Get an Extra Life", line: "In profitable rounds, eligible net losses create NFTs with capped, expiring rights to future house profit." },
    { icon: <Icon name="lock" size={20} />, title: "Claim or transfer", line: "Claim earned USDC, or list your Life. A buyer inherits unclaimed USDC; a sale needs a buyer." },
  ];
  return (
    <div className="panel mb-4 flex items-start gap-3 p-4">
      <ol className="grid flex-1 gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--panel-2)] text-[var(--primary)]">{s.icon}</span>
            <span className="text-sm">
              <b className="block">
                {i + 1}. {s.title}
              </b>
              <span className="text-[var(--muted)]">{s.line}</span>
            </span>
          </li>
        ))}
      </ol>
      <button className="btn btn-ghost shrink-0 px-2.5" onClick={close} aria-label="Got it, hide this">
        <Icon name="x" />
      </button>
    </div>
  );
}
