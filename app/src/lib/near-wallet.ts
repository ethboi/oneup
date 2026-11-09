"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NearConnector, NearWalletBase, EventMap } from "@hot-labs/near-connect";
import { FailoverProvider, rpcList } from "@oneup/sdk";
import { JsonRpcProvider } from "near-api-js";
import type { AppDeployment } from "./app-config";
import { assertTestnetWallet, walletOptions, signedInAccount } from "./wallet-config";
import { untilFinal, walletSender, type SendPhase } from "./wallet-send";

/**
 * What the wallet is doing:
 *
 *   unavailable (local demo: it signs with dev keys, not a wallet)
 *   disconnected ─connect─> connecting ─> connected ─send─> signing ─> confirming ─> connected
 *   connected ─disconnect─> disconnecting ─> disconnected
 *
 * Any request can fail back to where it started, with `error` set. One request at a time (the signing lock).
 */
export type WalletStatus = "unavailable" | "disconnected" | "connecting" | "connected" | SendPhase | "disconnecting";
type Request = "connecting" | "disconnecting" | SendPhase;

export function useNearWallet(d: AppDeployment) {
  const [accountId, setAccountId] = useState("");
  const [request, setRequest] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = useRef("");
  const chosenWallet = useRef<NearWalletBase | null>(null);
  const signingLock = useRef({ busy: false });
  const provider = useMemo(
    () => (d.network === "testnet" ? new FailoverProvider(rpcList(d.rpcUrl)) : new JsonRpcProvider({ url: d.rpcUrl })),
    [d.network, d.rpcUrl],
  );
  const pending = useRef<Promise<NearConnector> | null>(null);
  const enabled = d.network === "testnet";
  const clearAccount = useCallback(() => { selected.current = ""; chosenWallet.current = null; setAccountId(""); }, []);
  const connector = useCallback(() => {
    if (!enabled) return Promise.reject(new Error("NEAR wallets connect to the testnet profile, not the local demo"));
    if (!pending.current) {
      pending.current = import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({
        ...walletOptions(d.network === "testnet" ? rpcList(d.rpcUrl) : [d.rpcUrl]),
        storage: {
          async get(key) { return localStorage.getItem(`oneup.testnet.wallet.${key}`); },
          async set(key, value) { localStorage.setItem(`oneup.testnet.wallet.${key}`, value); },
          async remove(key) { localStorage.removeItem(`oneup.testnet.wallet.${key}`); },
        },
      })).catch(e => { pending.current = null; throw e; });
    }
    return pending.current;
  }, [enabled, d.rpcUrl]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let stop: (() => void) | undefined;
    connector().then(c => {
      if (!live) return;
      const signedIn = ({ wallet, accounts, success }: EventMap["wallet:signIn"]) => {
        if (!live) return;
        try {
          assertTestnetWallet(wallet);
          const id = signedInAccount({ accounts, success });
          chosenWallet.current = wallet;
          selected.current = id;
          setAccountId(id); setError(null);
        } catch (e) { clearAccount(); setError(e instanceof Error ? e.message : String(e)); }
      };
      const signedOut = () => { if (live) clearAccount(); };
      // Some wallets return every remembered account from getAccounts. Only an explicit sign-in selects one.
      // Reconnect after a full page reload instead of silently selecting the wrong signer from remembered accounts.
      c.on("wallet:signIn", signedIn); c.on("wallet:signOut", signedOut);
      stop = () => { c.off("wallet:signIn", signedIn); c.off("wallet:signOut", signedOut); };
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; stop?.(); };
  }, [enabled, connector, clearAccount]);
  useEffect(() => {
    if (!enabled) return;
    const checkAccount = async () => {
      const wallet = chosenWallet.current, account = selected.current;
      if (!wallet || !account) return;
      try {
        const accounts = await wallet.getAccounts({ network: "testnet" });
        if (chosenWallet.current === wallet && selected.current === account && !accounts.some(a => a.accountId === account)) {
          clearAccount(); setError("Your wallet account changed. Connect again to select your testnet account.");
        }
      } catch { /* A transient wallet error must not select another account. The sender checks again. */ }
    };
    const changedInAnotherTab = (event: StorageEvent) => {
      const id = chosenWallet.current?.manifest.id;
      if (id && (!event.key || event.key.startsWith(`${id}:`) || event.key.startsWith("oneup.testnet.wallet."))) {
        clearAccount(); setError("The wallet connection changed in another tab. Connect again before continuing.");
      }
    };
    window.addEventListener("focus", checkAccount);
    window.addEventListener("storage", changedInAnotherTab);
    return () => { window.removeEventListener("focus", checkAccount); window.removeEventListener("storage", changedInAnotherTab); };
  }, [enabled, clearAccount]);
  const connect = useCallback(async () => {
    if (signingLock.current.busy) { setError("Finish the pending wallet request first."); return; }
    signingLock.current.busy = true;
    setRequest("connecting"); setError(null);
    try {
      const c = await connector();
      // Account-only connection: no signed message, access key or transaction is requested by OneUp.
      await c.connect();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message === "User rejected" ? "Wallet connection cancelled." : message);
    }
    finally { signingLock.current.busy = false; setRequest(null); }
  }, [connector]);
  const disconnect = useCallback(async () => {
    if (signingLock.current.busy) { setError("Finish the pending wallet request first."); return; }
    signingLock.current.busy = true;
    setRequest("disconnecting"); setError(null);
    try {
      const c = await connector();
      if (chosenWallet.current) await c.disconnect(chosenWallet.current);
      clearAccount();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { signingLock.current.busy = false; setRequest(null); }
  }, [connector, clearAccount]);
  const boundSend = useMemo(() => walletSender(
    async () => {
      const wallet = chosenWallet.current;
      if (!wallet) throw new Error("Connect your NEAR testnet wallet first");
      assertTestnetWallet(wallet);
      return wallet;
    },
    () => selected.current,
    new Set(Object.values(d.contracts).filter((x): x is string => !!x)),
    {
      accountId, lock: signingLock.current, onPhase: setRequest,
      // keep asking while the RPC hasn't seen it yet: the wallet may have sent it through another one
      confirm: (hash, signer) => untilFinal(() => provider.viewTransactionStatusWithReceipts({ txHash: hash, accountId: signer, waitUntil: "FINAL" })),
    },
  ), [d.contracts, accountId, provider]);
  const send = useCallback<typeof boundSend>(async call => {
    if (signingLock.current.busy) return boundSend(call);
    // checking the account comes first, then the wallet's approval: "signing" covers both
    setRequest("signing");
    try { return await boundSend(call); }
    catch (e) {
      // which wallet, for the error report (lib/report.ts)
      const wallet = chosenWallet.current?.manifest.id;
      throw e instanceof Error ? Object.assign(e, { wallet }) : e;
    }
    finally { setRequest(null); }
  }, [boundSend]);
  const status: WalletStatus = !enabled ? "unavailable" : request ?? (accountId ? "connected" : "disconnected");
  /** A wallet request is under way: connect, disconnect and other requests wait for it. */
  const busy = request !== null;
  return { accountId, status, busy, error, connect, disconnect, send };
}
