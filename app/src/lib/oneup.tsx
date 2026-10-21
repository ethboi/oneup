"use client";

// App-wide state: the deployment, the SDK client, the dev wallet (localnet keys), live prices with history,
// and a `run` helper that shows each transaction's progress.

import { Account, type KeyPairString } from "near-api-js";
import { sfx } from "./sound";
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
      .then(async (r) => (r.ok ? setD(viaProxy(await r.json())) : setError((await r.json()).error)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <Splash text={error} />;
  if (!d) return <Splash text="Connecting to localnet…" />;
  return <Loaded d={d}>{children}</Loaded>;
}

/** Off this machine (a phone on the LAN), the chain's 127.0.0.1 RPC is unreachable: go through /api/rpc. */
function viaProxy(d: Deployment): Deployment {
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
  return local ? d : { ...d, rpcUrl: `${location.origin}/api/rpc` };
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
    sfx("send");
    setToasts((t) => [...t, { id, text: label, kind: "pending" }]);
    const done = (kind: Toast["kind"], text: string) => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, kind, text } : x)));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 3000);
    };
    try {
      await f();
      if (/^Claim/.test(label)) sfx("claim");
      done("ok", label);
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      sfx("error");
      done("error", `${label}: ${cleanError(e)}`);
      return false;
    }
  }, []);

  // Prices: poll the oracle every second and keep the last 1,800 updates (30 minutes) per market. A point is added only
  // when the oracle publishes a new price, at the moment it arrives, so the chart moves with real updates
  // instead of repeating the same price on every poll.
  const [prices, setPrices] = useState<Record<string, bigint>>({});
  const [history, setHistory] = useState<Record<string, { t: number; p: number }[]>>({});
  useEffect(() => {
    let live = true;
    const published = new Map<string, number>();
    const tick = async () => {
      const markets = await o.markets().catch(() => []);
      const next: Record<string, bigint> = {};
      const fresh: Record<string, number> = {};
      await Promise.all(
        markets.map(async (m) => {
          const p = await o.price(m.feed_id).catch(() => null);
          const v = p && normalizePrice(BigInt(p.price), p.expo);
          if (!v) return;
          next[m.id] = v;
          if (published.get(m.id) !== p.publish_time) {
            published.set(m.id, p.publish_time);
            fresh[m.id] = Number(v) / 1e8;
          }
        }),
      );
      if (!live) return;
      setPrices(next);
      if (Object.keys(fresh).length === 0) return;
      const t = Date.now();
      setHistory((h) => {
        const out = { ...h };
        for (const [k, p] of Object.entries(fresh)) out[k] = (out[k] ?? []).concat({ t, p }).slice(-1800);
        return out;
      });
    };
    tick();
    const i = setInterval(tick, 1000);
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

/** The start-up screen: the logo drops into a green LCD, like an old handheld booting. */
function Splash({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="case w-full max-w-sm p-4">
        <div className="bezel p-3 pb-6">
          <div className="lcd flex h-48 flex-col items-center justify-center gap-3 overflow-hidden">
            <span className="boot-logo display text-4xl italic text-[var(--lcd-ink)]">OneUp</span>
            <span className="boot-text display text-sm text-[var(--lcd-3)]">{text}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
