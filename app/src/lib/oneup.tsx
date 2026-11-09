"use client";

// App-wide state: the deployment, the SDK client, the dev wallet (localnet keys), live prices with history,
// and a `run` helper that shows each transaction's progress.

import { Account, type KeyPairString } from "near-api-js";
import type { AppDeployment } from "./app-config";
import { useNearWallet } from "./near-wallet";
import { accessOf, type Access } from "./access";
import { WalletWelcome } from "@/components/WalletWelcome";
import { sfx } from "./sound";
import { pollSerial } from "./poll";
import { loadSession, saveSession, sessionExists, sessionSender, type Session } from "./session";
import { FailoverProvider, OneUp, accountSender, normalizePrice, rpcList } from "@oneup/sdk";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface Toast {
  id: number;
  text: string;
  kind: "pending" | "ok" | "error";
}

interface Ctx {
  d: AppDeployment;
  o: OneUp;
  accounts: { id: string; label: string }[];
  me: string;
  setMe: (id: string) => void;
  tx: ReturnType<OneUp["calls"]>;
  /** The signed-in account with its main key (for adding and removing session keys). */
  main: Account | null;
  /** The main key itself (localnet dev wallet), for signing NEAR Intents. */
  mainKey: string | null;
  wallet: ReturnType<typeof useNearWallet>;
  /** The trade-only session key, when one is on. */
  session: Session | null;
  run: (label: string, f: () => Promise<unknown>) => Promise<boolean>;
  toasts: Toast[];
  /** Latest price per market (1e8 units) and recent history (USD). */
  prices: Record<string, bigint>;
  history: Record<string, { t: number; p: number }[]>;
  /** When the oracle published each market's latest price (seconds). */
  publishedAt: Record<string, number>;
  /** Bumps after every successful transaction so views refetch. */
  version: number;
  /** Testnet without a connected wallet: everything shows, and any action asks for a wallet first. */
  viewOnly: boolean;
  /** Who's using the app (see Access). */
  access: Access;
}


/** What an account-specific read answers for no account (view-only), without asking the chain. */
const NOBODY: Record<string, unknown> = {
  balance: "0", usdcBalance: "0", oneupBalance: "0", tickets: "0", pendingLife: "0",
  positions: [], orders: [], lives: [], locks: [],
};
function withoutAccount(o: OneUp): OneUp {
  return new Proxy(o, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof key !== "string" || !(key in NOBODY) || typeof v !== "function") return v;
      return (account: string, ...rest: unknown[]) => (account === "" ? Promise.resolve(NOBODY[key]) : v.call(target, account, ...rest));
    },
  });
}
const WATCH_KEY = "oneup.testnet.viewOnly";

const OneUpContext = createContext<Ctx | null>(null);

/** Public testnet RPCs limit each IP, and a tab at the local chain's pace (about 230 requests a minute) runs into
 *  that limit. A transaction still refreshes straight away: `version` restarts every poll. */
const pollFactor = (network: string) => (network === "testnet" ? 4 : 1);

export function useOneUp() {
  const c = useContext(OneUpContext);
  if (!c) throw new Error("useOneUp outside provider");
  return c;
}

/** Loading the deployment: loading ─> ready, or failed with the reason. */
type Load = { status: "loading" } | { status: "failed"; error: string } | { status: "ready"; d: AppDeployment };

export function OneUpProvider({ children }: { children: ReactNode }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    fetch("/api/config")
      .then(async (r) => setLoad(r.ok ? { status: "ready", d: viaProxy(await r.json()) } : { status: "failed", error: (await r.json()).error }))
      .catch((e) => setLoad({ status: "failed", error: String(e) }));
  }, []);

  if (load.status === "failed") return <Splash text={load.error} />;
  if (load.status === "loading") return <Splash text="Connecting to OneUp…" />;
  return <Loaded d={load.d}>{children}</Loaded>;
}

/** Off this machine (a phone on the LAN), the chain's 127.0.0.1 RPC is unreachable: go through /api/rpc. */
function viaProxy(d: AppDeployment): AppDeployment {
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
  return local || d.network !== "localnet" ? d : { ...d, rpcUrl: `${location.origin}/api/rpc` };
}

function Loaded({ d, children }: { d: AppDeployment; children: ReactNode }) {
  const o = useMemo(
    () => withoutAccount(d.network === "testnet" ? new OneUp(d, new FailoverProvider(rpcList(d.rpcUrl))) : new OneUp(d)),
    [d],
  );
  const wallet = useNearWallet(d);
  // a visitor can look around before connecting a wallet; remembered for this browser
  // read straight away (this only renders in the browser), so the wallet screen doesn't flash for someone already looking around
  const [watching, setWatching] = useState(() => {
    try { return localStorage.getItem(WATCH_KEY) === "1"; } catch { return false; }
  });
  const watch = useCallback(() => {
    setWatching(true);
    try { localStorage.setItem(WATCH_KEY, "1"); } catch {}
  }, []);
  const accounts = useMemo(
    () => d.demo ? [{ id: d.demo.id, label: "demo" }, ...d.bots.map((b, i) => ({ id: b.id, label: `bot ${i + 1}` }))] : [],
    [d],
  );
  const [localMe, setMeState] = useState(d.demo?.id ?? "");
  const me = d.network === "localnet" ? localMe : wallet.accountId;
  const access = accessOf(d.network, me, watching);
  const viewOnly = access === "welcome" || access === "watching";
  useEffect(() => {
    try {
      const saved = localStorage.getItem("oneup.account");
      if (saved && accounts.some((a) => a.id === saved)) setMeState(saved);
    } catch {}
  }, [accounts]);
  const setMe = useCallback((id: string) => {
    if (d.network !== "localnet" || !accounts.some(a => a.id === id)) return;
    setMeState(id);
    try {
      localStorage.setItem("oneup.account", id);
    } catch {}
  }, [d.network, accounts]);

  // the main key (localnet dev wallet), and a session key for trades when one is on (lib/session.ts)
  const mainKey = useMemo(() => d.network === "localnet" ? [d.demo, ...d.bots].find(a => a?.id === me)?.key ?? null : null, [d, me]);
  const main = useMemo(() => mainKey ? new Account(me, o.provider, mainKey as KeyPairString) : null, [o, me, mainKey]);
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      const saved = d.network === "localnet" ? loadSession(me) : null;
      setSession(saved);
      if (saved) void sessionExists(o.provider, me, saved).then(exists => {
        if (live && !exists && loadSession(me)?.publicKey === saved.publicKey) saveSession(me, null);
      }).catch(() => { /* Keep the saved key on an RPC failure; the sender checks again before signing. */ });
    };
    read();
    window.addEventListener("oneup-session", read);
    return () => { live = false; window.removeEventListener("oneup-session", read); };
  }, [me, d.network, o]);
  const tx = useMemo(() => {
    const send = main ? accountSender(main) : wallet.send;
    return o.calls(session ? sessionSender(me, o.provider, session, d.contracts.house, send) : send);
  }, [d, o, me, main, session, wallet.send]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState(0);
  const nextId = useRef(1);
  const connect = wallet.connect;
  const run = useCallback(async (label: string, f: () => Promise<unknown>) => {
    const id = nextId.current++;
    if (viewOnly) {
      // nothing to sign with yet: open the wallet picker, and say why
      setToasts((t) => [...t, { id, text: `Connect a NEAR testnet wallet to ${label.charAt(0).toLowerCase()}${label.slice(1)}`, kind: "error" }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
      void connect();
      return false;
    }
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
  }, [viewOnly, connect]);

  // Prices: poll the oracle every second and keep the last 1,800 updates (30 minutes) per market. A point is added only
  // when the oracle publishes a new price, at the moment it arrives, so the chart moves with real updates
  // instead of repeating the same price on every poll.
  const [prices, setPrices] = useState<Record<string, bigint>>({});
  const [history, setHistory] = useState<Record<string, { t: number; p: number }[]>>({});
  const [publishedAt, setPublishedAt] = useState<Record<string, number>>({});
  useEffect(() => {
    // the connect screen shows no prices
    if (access === "welcome") return;
    let live = true;
    const published = new Map<string, number>();
    const tick = async () => {
      const markets = await o.markets().catch(() => []);
      const next: Record<string, bigint> = {};
      const fresh: Record<string, number> = {};
      const times: Record<string, number> = {};
      await Promise.all(
        markets.map(async (m) => {
          const p = await o.price(m.feed_id).catch(() => null);
          const v = p && normalizePrice(BigInt(p.price), p.expo);
          if (!v) return;
          next[m.id] = v;
          times[m.id] = p.publish_time;
          if (published.get(m.id) !== p.publish_time) {
            published.set(m.id, p.publish_time);
            fresh[m.id] = Number(v) / 1e8;
          }
        }),
      );
      if (!live) return;
      setPrices(next);
      setPublishedAt(times);
      if (Object.keys(fresh).length === 0) return;
      const t = Date.now();
      setHistory((h) => {
        const out = { ...h };
        // the first price starts the line straight away: a market that isn't moving may not publish another for a while
        for (const [k, p] of Object.entries(fresh)) out[k] = (out[k]?.length ? out[k] : [{ t: t - 1000, p }]).concat({ t, p }).slice(-1800);
        return out;
      });
    };
    const stop = pollSerial(tick, () => {}, 1000 * pollFactor(d.network));
    // the server (or, on testnet, the indexer) has been watching too: start the chart from its last 30 minutes
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
  }, [o, d.network, access]);

  const value: Ctx = { d, o, accounts, me, setMe, tx, main, mainKey, session, wallet, run, toasts, prices, history, publishedAt, version, viewOnly, access };
  return <OneUpContext.Provider value={value}>{access === "welcome" ? <WalletWelcome connect={wallet.connect} busy={wallet.busy} error={wallet.error} watch={watch} /> : children}</OneUpContext.Provider>;
}

/** Polls `f` every `ms` and whenever `deps` or the transaction version change. */
export function usePoll<T>(f: () => Promise<T>, deps: unknown[], baseMs = 2000): T | undefined {
  const { version, d } = useOneUp();
  const ms = baseMs * pollFactor(d.network);
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

/** While the deployment loads: the plain background, so nothing flashes before the power-on screen. A slow connection gets its message after a moment. */
function Splash({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <span className="splash-text label" role="status">{text}</span>
    </div>
  );
}
