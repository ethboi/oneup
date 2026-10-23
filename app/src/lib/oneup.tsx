"use client";

// App-wide state: the deployment, the SDK client, the dev wallet (localnet keys), live prices with history,
// and a `run` helper that shows each transaction's progress.

import { Account, type KeyPairString } from "near-api-js";
import { sfx } from "./sound";
import { pollSerial } from "./poll";
import { loadSession, sessionSender, type Session } from "./session";
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
  /** The signed-in account with its main key (for adding and removing session keys). */
  main: Account;
  /** The main key itself (localnet dev wallet), for signing NEAR Intents. */
  mainKey: string;
  /** The trade-only session key, when one is on. */
  session: Session | null;
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

  // the main key (localnet dev wallet), and a session key for trades when one is on (lib/session.ts)
  const mainKey = useMemo(() => [d.demo, ...d.bots].find((a) => a.id === me)!.key, [d, me]);
  const main = useMemo(() => new Account(me, o.provider, mainKey as KeyPairString), [o, me, mainKey]);
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const read = () => setSession(loadSession(me));
    read();
    window.addEventListener("oneup-session", read);
    return () => window.removeEventListener("oneup-session", read);
  }, [me]);
  const tx = useMemo(() => {
    const send = accountSender(main);
    return o.calls(session ? sessionSender(me, o.provider, session, d.contracts.house, send) : send);
  }, [d, o, me, main, session]);

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
    const stop = pollSerial(tick, () => {}, 1000);
    // the server has been watching too: start the chart from its last 30 minutes rather than empty
    fetch("/api/prices")
      .then((r) => (r.ok ? r.json() : {}))
      .then((past: Record<string, { t: number; p: number }[]>) => {
        if (!live) return;
        setHistory((h) => {
          const out = { ...h };
          for (const [k, pts] of Object.entries(past)) {
            const mine = out[k] ?? [];
            const before = pts.filter((x) => x.t < (mine[0]?.t ?? Infinity));
            out[k] = before.concat(mine).slice(-1800);
          }
          return out;
        });
      })
      .catch(() => {});
    return () => {
      live = false;
      stop();
    };
  }, [o]);

  const value: Ctx = { d, o, accounts, me, setMe, tx, main, mainKey, session, run, toasts, prices, history, version };
  return <OneUpContext.Provider value={value}>{children}</OneUpContext.Provider>;
}

/** Polls `f` every `ms` and whenever `deps` or the transaction version change. */
export function usePoll<T>(f: () => Promise<T>, deps: unknown[], ms = 2000): T | undefined {
  const { version } = useOneUp();
  // Identity changes invalidate the old value during render, before effects can run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const identity = useMemo(() => ({}), deps);
  const [snapshot, setSnapshot] = useState<{ identity: object; value: T }>();
  useEffect(() => pollSerial(f, value => setSnapshot({ identity, value }), ms), [identity, version, ms]);
  return snapshot?.identity === identity ? snapshot.value : undefined;
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
