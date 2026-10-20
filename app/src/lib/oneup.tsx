"use client";

// App-wide state: the deployment, the SDK client, the dev wallet (localnet keys), live prices with history,
// and a `run` helper that shows each transaction's progress.

import { Account, type KeyPairString } from "near-api-js";
import { OneUp, accountSender, normalizePrice, type Deployment } from "@oneup/sdk";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface Toast {
  id: number;
  text: string;
  kind: "pending" | "ok" | "error";
}

interface Ctx {
  d: Deployment;
  o: OneUp;
  accounts: { id: string; label: string }[];
  me: string;
  setMe: (id: string) => void;
  tx: ReturnType<OneUp["calls"]>;
  run: (label: string, f: () => Promise<unknown>) => Promise<boolean>;
  toasts: Toast[];
  /** Latest price per market (1e8 units) and recent history (USD). */
  prices: Record<string, bigint>;
  history: Record<string, { t: number; p: number }[]>;
  /** Bumps after every successful transaction so views refetch. */
  version: number;
}

const OneUpContext = createContext<Ctx | null>(null);

export function useOneUp() {
  const c = useContext(OneUpContext);
  if (!c) throw new Error("useOneUp outside provider");
  return c;
}

export function OneUpProvider({ children }: { children: ReactNode }) {
  const [d, setD] = useState<Deployment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then(async (r) => (r.ok ? setD(await r.json()) : setError((await r.json()).error)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <Splash text={error} />;
  if (!d) return <Splash text="Connecting to localnet…" />;
  return <Loaded d={d}>{children}</Loaded>;
}

function Loaded({ d, children }: { d: Deployment; children: ReactNode }) {
  const o = useMemo(() => new OneUp(d), [d]);
  const accounts = useMemo(
    () => [{ id: d.demo.id, label: "demo" }, ...d.bots.map((b, i) => ({ id: b.id, label: `bot ${i + 1}` }))],
    [d],
  );
  const [me, setMeState] = useState(d.demo.id);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("oneup.account");
      if (saved && accounts.some((a) => a.id === saved)) setMeState(saved);
    } catch {}
  }, [accounts]);
  const setMe = useCallback((id: string) => {
    setMeState(id);
    try {
      localStorage.setItem("oneup.account", id);
    } catch {}
  }, []);

  const tx = useMemo(() => {
    const key = [d.demo, ...d.bots].find((a) => a.id === me)!.key as KeyPairString;
    return o.calls(accountSender(new Account(me, o.provider, key)));
  }, [d, o, me]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState(0);
  const nextId = useRef(1);
  const run = useCallback(async (label: string, f: () => Promise<unknown>) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text: label, kind: "pending" }]);
    const done = (kind: Toast["kind"], text: string) => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, kind, text } : x)));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 3000);
    };
    try {
      await f();
      done("ok", label);
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      done("error", `${label}: ${cleanError(e)}`);
      return false;
    }
  }, []);

  // Prices: poll the oracle and keep ~10 minutes of history per market.
  const [prices, setPrices] = useState<Record<string, bigint>>({});
  const [history, setHistory] = useState<Record<string, { t: number; p: number }[]>>({});
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const markets = await o.markets().catch(() => []);
      const next: Record<string, bigint> = {};
      await Promise.all(
        markets.map(async (m) => {
          const p = await o.price(m.feed_id).catch(() => null);
          const v = p && normalizePrice(BigInt(p.price), p.expo);
          if (v) next[m.id] = v;
        }),
      );
      if (!live) return;
      setPrices(next);
      const t = Date.now();
      setHistory((h) => {
        const out = { ...h };
        for (const [k, v] of Object.entries(next)) {
          const arr = (out[k] ?? []).concat({ t, p: Number(v) / 1e8 });
          out[k] = arr.slice(-300);
        }
        return out;
      });
    };
    tick();
    const i = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [o]);

  const value: Ctx = { d, o, accounts, me, setMe, tx, run, toasts, prices, history, version };
  return <OneUpContext.Provider value={value}>{children}</OneUpContext.Provider>;
}

/** Polls `f` every `ms` and whenever `deps` or the transaction version change. */
export function usePoll<T>(f: () => Promise<T>, deps: unknown[], ms = 2000): T | undefined {
  const { version } = useOneUp();
  const [v, setV] = useState<T>();
  useEffect(() => {
    let live = true;
    const tick = () => f().then((x) => live && setV(x)).catch(() => {});
    tick();
    const i = setInterval(tick, ms);
    return () => {
      live = false;
      clearInterval(i);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, ms]);
  return v;
}

function cleanError(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  const m = s.match(/Smart contract panicked: ([^"\n]+)/) ?? s.match(/panicked at [^:]+:\d+:\d+:\\?n?([^"\n]+)/);
  return (m?.[1] ?? s.split("\n")[0]).slice(0, 160);
}

function Splash({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-[var(--muted)]">{text}</p>
    </div>
  );
}
